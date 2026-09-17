// The commit convention, checked instead of hoped for.
//
// The `commits-conventionnels` rule weighed 2.1 kB in every session's system prompt, on two
// projects, and guaranteed nothing: a prompt is an instruction, and instructions get missed. This
// module makes it checkable. A `PreToolUse` hook reads the commit and, since 08/09, advises rather
// than refuses (see `adviceText`), which lets the instruction leave the prompt.
//
// What it checks, and no more. The project's rule says: "`feat` when the commit adds a feature, `fix`
// when it fixes a bug. The other types are free, and the target repository decides which it
// accepts." A type allowlist would be stricter than the rule it applies (it would refuse a
// legitimate `deps:` in a repository that accepts it). So this checks the form, the only thing the
// spec really imposes:
//
//     <type>[(scope)][!]: <description>
//
// Colon and space are required (the spec says it twice), the description cannot be empty, the type
// cannot contain a space. That covers the real mistakes: a bare message, a `WIP`, a `fix:no-space`.
//
// What it lets through on purpose: a message it cannot read is not a wrong message. Refusing what
// cannot be checked would close legitimate paths, and a guardrail blocking correct work gets
// disabled within the week:
//
//   · `-F file` / `--file` / heredoc: the message is not in the command.
//   · `--amend --no-edit`, `--no-edit`, `-C`/`--reuse-message`: no new message.
//   · no `-m` at all: git would open an editor and fail by itself non-interactively.
//
// Not the runner's own commits: they go through `execFile`, not the agent's `Bash` tool, so this hook
// never sees them. They conform anyway (`chore:`), but what matters is that no self-blocking is
// possible.
//
// Pure: no disk, no network, no SDK, so testable without mounting a session.

/** The form conventionalcommits v1.0.0 imposes, reduced to what is checkable without knowing the
 *  repository: a type without spaces, an optional scope in parentheses, an optional `!`, then `: `
 *  and a non-empty description. */
const CONVENTIONAL = /^[^\s():!]+(\([^()]*\))?!?: \S/;

/** A message's subject is its first line. Body and footers are not ours to judge: the spec makes
 *  them optional and their form depends on the repository. */
// `?? ""`: `split` always returns at least one element, which an index does not tell the type.
const subjectOf = (message: string | null | undefined) =>
  (String(message).split("\n", 1)[0] ?? "").trim();

/** Messages passed on the command line, in order.
 *
 *  Only `-m`/`--message`, in the three spellings an agent produces: `-m "text"`, `-m 'text'`,
 *  `-m text`. A bash `$'...'` is read as single-quoted, which is enough: the goal is reading the
 *  subject to judge it, not reimplementing shell word splitting. */
export function commitMessages(command: string): string[] {
  const out: string[] = [];
  const re = /(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g;
  let m;
  while ((m = re.exec(String(command))) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    // Undo the most common shell escapes in a message, to judge the text as git will see it, not as
    // bash carried it.
    const text = raw.replace(/\\(["'`$\\])/g, "$1").replace(/\\n/g, "\n");
    // The heredoc form, `-m "$(cat <<'EOF' … EOF)"`, is what Claude Code writes by default (05/09):
    // the subject is the first line of the body, not `$(cat <<'EOF'`. Read literally, the rule
    // refused all these commits for "no type", the agent gave up committing and checkpoints collected
    // its work (session RGYPIbKFios1). A substitution that cannot be unfolded is not judged: refusing
    // what cannot be read closes legitimate paths.
    if (/^\s*\$\(/.test(text)) {
      const body = heredocBody(text);
      if (body === null) continue;
      out.push(body);
      continue;
    }
    out.push(text);
  }
  return out;
}

/** The body of a `$(cat <<'EOF' … EOF)`: what lies between the opening line and the end word, or
 *  `null` if it is not that form. The delimiter is whatever the command names (EOF or other), quoted
 *  or not; `<<-` is accepted as the shell accepts it. */
export function heredocBody(text: string): string | null {
  const m =
    /^\s*\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n\s*\2\s*\)?\s*$/.exec(
      String(text),
    );
  return m?.[3] ?? null;
}

/** Git's global options taking their value in the next token.
 *
 *  Needed to skip `repos/legion` in `git -C repos/legion commit`: otherwise the first non-option word
 *  is the path and the commit goes unnoticed. A regex covering that would be unreadable; a small
 *  explicit loop beats a clever pattern here. */
const GIT_OPTS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);

/** The arguments following each `git … commit` in the line.
 *
 *  A list of lists, one per commit found, empty if none. Splitting stops at the first shell
 *  separator, otherwise `git commit -m "x" && git push -f` would attribute push's options to the
 *  commit. Every `git` occurrence is tried, since a compound command carries several
 *  (`cd x && git commit`, `git add -A && git commit`). */
function commitArgs(command: string): string[][] {
  const tokens = String(command).split(/\s+/).filter(Boolean);
  // `noUncheckedIndexedAccess`: indices here are bounded by `tokens.length`, so never absent. This
  // reader says it once instead of seven `!`; out of bounds it returns `""`, which satisfies none of
  // the tests made on it, exactly like the former `undefined`.
  const at = (n: number): string => tokens[n] ?? "";
  const runs: string[][] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    // `git`, but also `/usr/bin/git`: the executable's name is what counts.
    if (!/(?:^|\/)git$/.test(at(i))) continue;
    let j = i + 1;
    // Skip global options and, for those taking one, their value.
    while (j < tokens.length && at(j).startsWith("-")) {
      const opt = at(j).includes("=") ? (at(j).split("=", 1)[0] ?? at(j)) : at(j);
      j += GIT_OPTS_WITH_VALUE.has(opt) && !at(j).includes("=") ? 2 : 1;
    }
    if (at(j) !== "commit") continue;
    const args: string[] = [];
    for (let k = j + 1; k < tokens.length && !/^(?:&&|\|\||;|\||>|>>)$/.test(at(k)); k += 1)
      args.push(at(k));
    runs.push(args);
  }
  return runs;
}

/** The position of `-C` decides its meaning, and confusing them was a bug caught by the tests.
 *
 *  Before the subcommand, `git -C <path> commit` names a directory; after it, `git commit -C <commit>`
 *  reuses another commit's message. Looking for `-C` in the whole line let
 *  `git -C repos/legion commit -m "anything"` pass as a commit without a new message, the easiest
 *  bypass to write. Hence reading the commit's arguments, not a pattern on the line. */
const REUSES_MESSAGE = new Set(["-C", "-c", "--reuse-message", "--reedit-message"]);
const READS_FILE = new Set(["-F", "--file"]);

/** Does the command contain a `git commit` that will create a message?
 *
 *  Returns `false` on anything that cannot be judged (see the header). `git log`, `git show` and other
 *  reads containing the word "commit" are not targeted: `commit` must be the subcommand. */
export function isCommitCreatingMessage(command: string): boolean {
  return commitArgs(command).some((args) => {
    const flags = args.map((a) => (a.includes("=") ? (a.split("=", 1)[0] ?? a) : a));
    // Message outside the command, or no new message: nothing to check.
    if (flags.some((f) => READS_FILE.has(f) || REUSES_MESSAGE.has(f) || f === "--no-edit"))
      return false;
    // Messages are read on the whole command, not on the re-joined arguments: tokenising ate the
    // newlines, and a heredoc without them no longer unfolds (05/09). Arguments only tell whether
    // this commit carries a `-m`.
    return flags.some((f) => /^(?:-m|--message)/.test(f)) && commitMessages(command).length > 0;
  });
}

/** What is wrong with this subject, or `null` if it conforms.
 *
 *  The message names the mistake and shows the expected form: a "no" without a remedy makes the agent
 *  retry at random, burning a turn each time. */
export function commitSubjectProblem(subject: string | null | undefined): string | null {
  const s = subjectOf(subject);
  if (!s) return "the message is empty";
  if (CONVENTIONAL.test(s)) return null;

  const colon = s.indexOf(":");
  if (colon === -1)
    return `"${s}" has no type: the "<type>: " prefix is missing, for example "fix: ${s.slice(0, 40)}"`;
  // An empty description is tested before the space, and the reverse order was a bug caught by the
  // tests: the subject is trimmed, so "chore:" loses its trailing space and was blamed for a missing
  // space when the description is missing. The suggested remedy was "chore:  ".
  if (!s.slice(colon + 1).trim()) return `"${s}" has no description after the colon`;
  if (s[colon + 1] !== " ")
    return `"${s}": a SPACE is required after the colon ("${s.slice(0, colon + 1)} ${s.slice(colon + 1).trim()}")`;
  const type = s.slice(0, colon);
  if (/\s/.test(type.replace(/\([^()]*\)/, "")))
    return `"${type}" is not a type: a type contains no space ("<type>(scope): description")`;
  return `"${s}" does not follow "<type>[(scope)][!]: <description>"`;
}

/** The verdict on a whole command, or `null` if nothing to say.
 *
 *  The first `-m` carries the subject; the following ones are the body, whose form is not our
 *  business (`git commit -m "fix: x" -m "detail"` is correct). */
export function commitProblem(command: string): string | null {
  if (!isCommitCreatingMessage(command)) return null;
  const [first] = commitMessages(command);
  if (first === undefined) return null;
  return commitSubjectProblem(first);
}

/** The text returned to the agent when the form is off. It carries the rule and the example, which
 *  is what replaces the 2.1 kB the rule took in the prompt.
 *
 *  It advises, it no longer refuses (08/09, operator's decision). The module returned `deny`: the
 *  commit did not happen and the agent had to redo it. That bought a guaranteed form at the price of
 *  a model turn per mistake, and above all the risk of a blockage: a guardrail wrong about its own
 *  tool's default form makes the agent give up committing, which happened on 05/09 with the heredoc
 *  form (since fixed).
 *
 *  So the commit goes through and the remark enters the agent's context through
 *  `additionalContext`: it reads it next turn and amends. The convention is still checked on every
 *  commit, it is just no longer a gate. The trace still carries the warning, so the operator sees
 *  what was let through. */
export function adviceText(problem: string): string {
  return (
    `This commit does not follow the project's convention: ${problem}.\n\n` +
    `This project's commit messages follow conventionalcommits.org v1.0.0:\n` +
    `    <type>[(scope)][!]: <description>\n\n` +
    `"feat" for a feature, "fix" for a fix; the other types (chore, ` +
    `refactor, docs, test, perf, ci, build, style) are accepted if the repository uses them — ` +
    `look at its latest commits. The scope is optional, the colon and the space are ` +
    `required. A "!" before the colon announces a breaking change.\n\n` +
    `The commit did happen. Fix the message with ` +
    `\`git commit --amend -m "<type>: <description>"\` before pushing.`
  );
}
