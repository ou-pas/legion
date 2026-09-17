// The checkpoint rewrite plan, tested without git. The module ships in the session image and is
// imported as is: THE CODE THAT RUNS is what is tested. Same setup as commit-convention.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCheckpointCommit,
  planCheckpointSquash,
  squashOnlySubject,
  TRAILING_SUBJECT,
} from "../../../runner-payload/checkpoint-squash.mjs";

const ck = (turn: number, session = "abc") =>
  `chore: checkpoint (turn ${turn}) — session ${session}`;

describe("isCheckpointCommit: the shape checkpointRepos writes", () => {
  it("recognises a checkpoint whatever the session or turn", () => {
    assert.equal(isCheckpointCommit(ck(15)), true);
    assert.equal(isCheckpointCommit(ck(150, "RGYPIbKFios1")), true);
    // Session of an EARLIER resume: never cleaned before this module, must be cleaned anyway.
    assert.equal(isCheckpointCommit(ck(30, "enn_HqlVFGVt")), true);
  });

  it("recognises the French subject written before the switch to English (legacy data, kept on purpose)", () => {
    assert.equal(isCheckpointCommit("chore: checkpoint (tour 45) — session abc"), true);
  });

  it("judges only the first line", () => {
    assert.equal(isCheckpointCommit(`${ck(15)}\n\na body`), true);
  });

  it("lets through anything without exactly that shape", () => {
    for (const not of [
      "feat: add the rules page",
      "chore: checkpoint turn 15 without dash",
      "chore: checkpoint (turn fifteen) — session abc",
      "chore: end of session — uncommitted work",
      "chore: checkpoint (turn 15)",
    ])
      assert.equal(isCheckpointCommit(not), false, `“${not}” must not be seen as a checkpoint`);
  });
});

describe("squashOnlySubject: the title when there are ONLY checkpoints", () => {
  it("prefers pr.md's first line", () => {
    assert.equal(
      squashOnlySubject("feat: the rules page\n\nBody.", "chore: fallback"),
      "feat: the rules page",
    );
  });

  it("strips a Markdown heading", () => {
    assert.equal(squashOnlySubject("# feat: title\nbody", "chore: fallback"), "feat: title");
  });

  it("falls back to the fallback title if pr.md is missing, empty, or has no useful line", () => {
    assert.equal(squashOnlySubject(null, "chore: fallback"), "chore: fallback");
    assert.equal(squashOnlySubject("", "chore: fallback"), "chore: fallback");
    assert.equal(squashOnlySubject("   \n\n  ", "chore: fallback"), "chore: fallback");
  });
});

describe("planCheckpointSquash: three cases, one algorithm", () => {
  it("no checkpoint in the range: nothing to rewrite", () => {
    const commits = [
      { sha: "a1", subject: "feat: x" },
      { sha: "a2", subject: "fix: y" },
    ];
    const plan = planCheckpointSquash(commits, { fallbackTitle: "chore: t" });
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.groups, [
      { kind: "keep", finalSha: "a1" },
      { kind: "keep", finalSha: "a2" },
    ]);
  });

  it("empty range: nothing to rewrite", () => {
    assert.deepEqual(planCheckpointSquash([], { fallbackTitle: "chore: t" }), {
      changed: false,
      groups: [],
    });
  });

  it("case 1: two checkpoints then a real commit: ONE commit, the agent's", () => {
    const commits = [
      { sha: "c1", subject: ck(15) },
      { sha: "c2", subject: ck(30) },
      { sha: "a1", subject: "feat: the feature" },
    ];
    const plan = planCheckpointSquash(commits, { fallbackTitle: "chore: t" });
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.groups, [{ kind: "keep", finalSha: "a1" }]);
  });

  it('case 2: NOTHING but checkpoints: one commit titled after the task, never "chore: checkpoint"', () => {
    const commits = [
      { sha: "c1", subject: ck(15) },
      { sha: "c2", subject: ck(30) },
    ];
    const plan = planCheckpointSquash(commits, { fallbackTitle: "feat: the task title" });
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.groups, [
      { kind: "rename", finalSha: "c2", subject: "feat: the task title" },
    ]);
  });

  it("case 2: pr.md written: its first line wins over the fallback title", () => {
    const commits = [{ sha: "c1", subject: ck(15) }];
    const plan = planCheckpointSquash(commits, {
      prMdRaw: "fix: the real title\n\nbody",
      fallbackTitle: "chore: t",
    });
    assert.deepEqual(plan.groups, [
      { kind: "rename", finalSha: "c1", subject: "fix: the real title" },
    ]);
  });

  it("case 3 without report: checkpoints AFTER the last real commit are named for what they are", () => {
    const commits = [
      { sha: "a1", subject: "feat: delivered part" },
      { sha: "c1", subject: ck(45) },
      { sha: "c2", subject: ck(60) },
    ];
    const plan = planCheckpointSquash(commits, { fallbackTitle: "chore: t" });
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.groups, [
      { kind: "keep", finalSha: "a1" },
      { kind: "rename", finalSha: "c2", subject: TRAILING_SUBJECT },
    ]);
  });

  // 10/09, task `ks1wcjyVMZ`: fifteen files, ALL the work, reached GitHub under the end-of-session
  // uncommitted-work subject, while `pr.md` opened two lines further on "feat(customers): tool
  // params speak {{ variables". The report knew how to name that commit; the commit did not ask.
  it("case 3 with report: the trailing group takes pr.md's title", () => {
    const commits = [
      { sha: "a1", subject: "chore: ignore stray core dumps" },
      { sha: "c1", subject: ck(105) },
      { sha: "c2", subject: ck(120) },
    ];
    const plan = planCheckpointSquash(commits, {
      prMdRaw: "feat(customers): tool params speak {{ variables\n\n## What\n…",
      fallbackTitle: "chore: t",
    });
    assert.deepEqual(plan.groups, [
      { kind: "keep", finalSha: "a1" },
      {
        kind: "rename",
        finalSha: "c2",
        subject: "feat(customers): tool params speak {{ variables",
      },
    ]);
  });

  it("case 3: a report title ALREADY carried by the last real commit keeps the admission", () => {
    // Two consecutive commits under the same subject can no longer be told apart: there, the
    // uncommitted-work subject says less but does not lie, and distinguishes the two lines.
    const commits = [
      { sha: "a1", subject: "feat: the work" },
      { sha: "c1", subject: ck(45) },
    ];
    const plan = planCheckpointSquash(commits, {
      prMdRaw: "feat: the work\n\nbody",
      fallbackTitle: "chore: t",
    });
    assert.deepEqual(plan.groups, [
      { kind: "keep", finalSha: "a1" },
      { kind: "rename", finalSha: "c1", subject: TRAILING_SUBJECT },
    ]);
  });

  it("several real commits separated by checkpoints, plus a trailing group: each real commit survives alone", () => {
    const commits = [
      { sha: "c0", subject: ck(15) },
      { sha: "a1", subject: "feat: first part" },
      { sha: "c1", subject: ck(30) },
      { sha: "a2", subject: "feat: second part" },
      { sha: "c2", subject: ck(45) },
      { sha: "c3", subject: ck(60) },
    ];
    const plan = planCheckpointSquash(commits, { fallbackTitle: "chore: t" });
    assert.deepEqual(plan.groups, [
      { kind: "keep", finalSha: "a1" },
      { kind: "keep", finalSha: "a2" },
      { kind: "rename", finalSha: "c3", subject: TRAILING_SUBJECT },
    ]);
  });

  it("pushRepos's catch-up commit (not a checkpoint) counts as a real commit", () => {
    // The end-of-session catch-up commit is not a checkpoint: it absorbs the checkpoints before it
    // like any other real commit.
    const commits = [
      { sha: "c1", subject: ck(15) },
      { sha: "cu", subject: "chore: end of session — uncommitted work" },
    ];
    const plan = planCheckpointSquash(commits, { fallbackTitle: "chore: t" });
    assert.deepEqual(plan.groups, [{ kind: "keep", finalSha: "cu" }]);
  });
});
