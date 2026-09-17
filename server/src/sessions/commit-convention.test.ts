// The commit convention, checked rather than hoped for. The module ships in the session image and
// is imported as is: THE CODE THAT RUNS is what is tested.
//
// These tests hold the line between "malformed" and "we cannot read it". A guardrail refusing
// correct work gets disabled within the week, so half these cases check that we LET THROUGH, and
// they count as much as the refusals.
//
// "Refuse" here means the DIAGNOSIS, no longer the verdict: since 08/09 the hook no longer returns
// `deny`, it puts the remark in the agent's context and lets the commit happen (session-hooks.mts).
// These functions did not change: they still say what is wrong.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commitMessages,
  commitProblem,
  commitSubjectProblem,
  isCommitCreatingMessage,
} from "../../../runner-payload/commit-convention.mjs";

const probleme = (cmd: string): string | null => commitProblem(cmd) as string | null;

describe("commitSubjectProblem: the conventional form", () => {
  it("accepts the spec's forms", () => {
    for (const ok of [
      "feat: add the rules page",
      "fix(parser): handle empty braces",
      "feat(api)!: the route changes shape",
      "chore: checkpoint (turn 15) — session abc",
      // Free type: the project rule says other types are free and the target repository decides which
      // it accepts. An allowlist would be stricter than the rule.
      "deps: bump drizzle to 0.44",
    ]) {
      assert.equal(commitSubjectProblem(ok), null, `“${ok}” should pass`);
    }
  });

  it("refuses a message WITHOUT a type, and suggests the form", () => {
    const p = commitSubjectProblem("add the rules page") as string;
    assert.match(p, /has no type/);
    assert.match(
      p,
      /fix: add the rules page/,
      "the refusal shows an example, otherwise the agent retries at random",
    );
  });

  it("refuses a missing SPACE after the colon", () => {
    // The spec requires it twice, and it is the most frequent mistake.
    const p = commitSubjectProblem("fix:no-space") as string;
    assert.match(p, /SPACE is required after the colon/);
    assert.match(p, /fix: no-space/, "the refusal gives the corrected version");
  });

  it("refuses an empty description", () => {
    assert.match(commitSubjectProblem("chore: ") as string, /no description/);
  });

  it("refuses an empty message", () => {
    assert.equal(commitSubjectProblem(""), "the message is empty");
    assert.equal(commitSubjectProblem("   "), "the message is empty");
  });

  it("judges ONLY the first line: the body is none of our business", () => {
    // The spec makes the body optional and its form depends on the repository.
    assert.equal(commitSubjectProblem("fix: x\n\na body\non two lines\n\nRefs: AI-1"), null);
  });
});

describe("commitMessages: reading the subject through the shell", () => {
  it("reads the three spellings an agent produces", () => {
    assert.deepEqual(commitMessages('git commit -m "feat: a"'), ["feat: a"]);
    assert.deepEqual(commitMessages("git commit -m 'feat: b'"), ["feat: b"]);
    assert.deepEqual(commitMessages("git commit -m feat:c"), ["feat:c"]);
    assert.deepEqual(commitMessages('git commit --message="feat: d"'), ["feat: d"]);
  });

  it("the first -m is the subject, the following ones are the body", () => {
    assert.deepEqual(commitMessages('git commit -m "fix: x" -m "the detail"'), [
      "fix: x",
      "the detail",
    ]);
    assert.equal(
      probleme('git commit -m "fix: x" -m "not conventional at all"'),
      null,
      "the body need not follow the convention",
    );
  });

  it("undoes the most common shell escapes", () => {
    assert.deepEqual(commitMessages('git commit -m "fix: l\\"accolade"'), ['fix: l"accolade']);
  });
});

describe("commitMessages: Claude Code's heredoc form (05/09)", () => {
  // `git commit -m "$(cat <<'EOF' … EOF)"` is Claude Code's DEFAULT form. Read as an ordinary
  // message, its subject was `$(cat <<'EOF'`, refused for lack of a type, and the agent gave up
  // committing (session RGYPIbKFios1: 45 turns without a commit, three checkpoints).
  const heredoc = (body: string) => `git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`;

  it("unfolds the heredoc and judges its body's first line", () => {
    assert.deepEqual(commitMessages(heredoc("chore(web): revert dev-only entry\n\nFree body.")), [
      "chore(web): revert dev-only entry\n\nFree body.",
    ]);
    assert.equal(probleme(heredoc("chore(web): revert dev-only entry")), null);
  });

  it("still refuses a heredoc whose first line has no type", () => {
    assert.match(probleme(heredoc("revert dev-only entry")) as string, /has no type/);
  });

  it("accepts an unquoted delimiter, or one other than EOF", () => {
    assert.equal(probleme(`git commit -m "$(cat <<MSG\nfix: x\nMSG\n)"`), null);
  });

  it("a substitution we cannot unfold is not judged", () => {
    // `$(printf …)`: the message exists but cannot be read, same rule as `-F`.
    assert.equal(probleme(`git commit -m "$(printf 'fix: %s' "$x")"`), null);
  });
});

describe("isCommitCreatingMessage: what we cannot read is not at fault", () => {
  it("sees a git commit in the middle of a compound command", () => {
    assert.equal(isCommitCreatingMessage('cd repos/legion && git commit -m "not good"'), true);
    assert.equal(isCommitCreatingMessage('git -C repos/legion commit -m "not good"'), true);
  });

  it("lets through a message outside the command", () => {
    // It cannot be read; refusing would close a legitimate path.
    assert.equal(isCommitCreatingMessage("git commit -F /tmp/msg"), false);
    assert.equal(isCommitCreatingMessage("git commit --file=/tmp/msg"), false);
    assert.equal(probleme("git commit -F /tmp/msg"), null);
  });

  it("lets through commits WITHOUT a new message", () => {
    assert.equal(isCommitCreatingMessage("git commit --amend --no-edit"), false);
    assert.equal(isCommitCreatingMessage("git commit -C HEAD@{1}"), false);
    assert.equal(
      isCommitCreatingMessage("git commit"),
      false,
      "git would open an editor and fail on its own",
    );
  });

  it("does NOT target reads containing the word commit", () => {
    for (const lecture of [
      "git log --oneline -3",
      "git show --stat HEAD",
      "git rev-parse HEAD",
      "git log --format=%H -1 -- commit",
    ]) {
      assert.equal(isCommitCreatingMessage(lecture), false, `“${lecture}” is not a commit`);
      assert.equal(probleme(lecture), null);
    }
  });

  it("`-C` BEFORE the subcommand is a path, not a message reuse", () => {
    // The same flag has two meanings depending on position: `git -C <path> commit` versus
    // `git commit -C <commit>`. Confusing them let through the easiest bypass to write: scoping the
    // commit to a repository was enough to escape the check.
    assert.equal(isCommitCreatingMessage('git -C repos/legion commit -m "not good"'), true);
    assert.match(probleme('git -C repos/legion commit -m "not good"') as string, /has no type/);
    // And after the subcommand it keeps its other meaning.
    assert.equal(isCommitCreatingMessage("git commit -C HEAD@{1}"), false);
  });

  it("options of a FOLLOWING command are not attributed to the commit", () => {
    // Without splitting on shell separators, `grep`'s `-F` (or anything's `--no-edit`) would disarm
    // the check of the commit before it.
    assert.equal(isCommitCreatingMessage('git commit -m "not good" && grep -F x file'), true);
    assert.match(probleme('git commit -m "not good" && git push') as string, /has no type/);
  });

  it("the runner's own commits comply", () => {
    // They go through execFile, not the Bash tool, so the hook does not see them; but if that ever
    // changed, they must not be refused by their own guardrail.
    assert.equal(probleme('git commit -m "chore: checkpoint (turn 15) — session abc"'), null);
    assert.equal(probleme('git commit -m "chore: end of session — uncommitted work"'), null);
  });
});
