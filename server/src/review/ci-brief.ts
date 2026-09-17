// The brief block for a red CI: what the agent reads, and nothing else.
//
// Pure: no database, forge or network. It receives what could be read (the red job, its log tail,
// the change request's files) and returns text. This file decides the batch's value: an agent
// launched on "the CI is red" reruns the whole suite and burns twenty minutes rediscovering what
// the job already says.
//
// Three decisions taken with a real log in front of us ("red CI" batch):
//
//  1. Bounding the log: the last characters, plus the job URL. A real repository's `pnpm test` job
//     returns megabytes, mostly noise from before the failure. Looking for the first failure marker
//     would be better when the runner's format is known (`##[error]` on GitHub Actions, nothing
//     like it on GitLab, nothing at all on a bare `exit 1`), but a heuristic missing its marker
//     returns an arbitrary excerpt without saying so; the tail is always exactly what it claims.
//     The case it misses (a long teardown after the failure) is covered by the URL in the block.
//  2. Several red jobs: the first one's log, the others named with their URL. Three 12 KB logs in
//     a task description would drown the original brief, and red jobs of one run most often share
//     a cause.
//  3. A missing log does not remove the gesture: the project token may lack `actions:read` (GitHub
//     answers 403). The block says so, naming the missing scope, and the agent starts with the job
//     name and URL. Dropping the launch for that would remove the button exactly when it helps.
import { CHECK_STATE, type CheckState, type FailingCheck } from "../integrations/forge.js";

const CI_MARKER = "\n\n## CI fix";
// The French heading of tasks written before the switch to English, replaced like the current one.
export const CI_HEADINGS = [CI_MARKER, "\n\n## Correction de la CI"];

/** The kept log tail. 12,000 characters: enough for a full stack trace and the failure line before
 *  it, without pushing the original brief out of sight in the task description (read by a human as
 *  much as by the agent). */
export const LOG_TAIL_CHARS = 12_000;

/** How many other red jobs are named. Beyond that it is a dashboard, not a diagnosis, and the forge
 *  already has one. */
const OTHER_JOBS_CAP = 8;

/** Listed files. A change request over 80 files is not judged on a list; the remaining count is
 *  given, and the full diff is on the branch the agent has at hand. */
const FILES_CAP = 80;

/** ANSI escape sequences (colours, bold, cursor). Built from the escape character's code rather
 *  than written literally: an invisible control character in source is a trap for the reader. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** A log's tail, stripped of colours, bounded in characters, with a first line cut in the middle
 *  marked by `…` rather than dropped.
 *
 *  Two measurements on a real job (vitejs/vite #23453, 135,283-character log):
 *
 *   - ANSI escapes were 60% of the log. A CI runner colours its output, and vitest adds a progress
 *     bar of a thousand dots each wrapped in colour codes. Unstripped, a 12,000-character tail gave
 *     about fifteen lines of mush; stripped, 108 lines including "Failed Tests" and the assertion.
 *   - Dropping the cut line cost a third of the budget. The cut often lands inside a line over a
 *     thousand characters long; cutting at the next boundary left 4,037 of the 12,000 characters
 *     asked for, silently. The `…` says what truncation did and costs one character. */
export function logTail(
  log: string,
  maxChars: number = LOG_TAIL_CHARS,
): { text: string; truncated: boolean } {
  const clean = log.replace(ANSI, "").replace(/\r\n?/g, "\n").trimEnd();
  if (clean.length <= maxChars) return { text: clean, truncated: false };
  return { text: `…${clean.slice(clean.length - maxChars)}`, truncated: true };
}

export type CiBriefInput = {
  changeRequestLabel: string;
  repoName: string;
  number: number;
  /** Red jobs, the first one leading: its log is the one quoted. */
  failing: readonly FailingCheck[];
  /** The first job's raw output, or `null` if the forge did not return it. */
  log: string | null;
  /** The change request's files, or `null` if the diff could not be read. */
  files: readonly { path: string; status: string }[] | null;
};

/** The block injected into the description. */
export function ciFixBlock(input: CiBriefInput): string {
  const first = input.failing[0];
  const lines = [
    `${CI_MARKER} (system instructions — the CI of your change request is failing)`,
    `The CI of your ${input.changeRequestLabel} #${input.number} on repo "${input.repoName}" is failing.`,
    "You are resuming YOUR OWN branch (already pushed — do not create a new one).",
    "",
    `### Failing job: ${first?.name ?? "(unnamed)"}`,
    first?.url || "(no URL given by the forge)",
  ];

  lines.push("", "### Job log");
  if (input.log === null) {
    lines.push(
      "NOT AVAILABLE — the forge did not return it. On GitHub this is usually a project token " +
        "without the `actions:read` scope; it can also be an expired log. Open the job URL above " +
        "and read it there. This is not a reason to stop: the job name and its URL are enough to " +
        "start.",
    );
  } else {
    const { text, truncated } = logTail(input.log);
    lines.push(
      truncated
        ? `Verbatim tail of the log (last ${LOG_TAIL_CHARS} characters — the full log is at the URL above):`
        : "Verbatim log:",
      "```",
      text,
      "```",
    );
  }

  const others = input.failing.slice(1);
  if (others.length > 0) {
    lines.push("", "### Other failing jobs (same run — most often the same cause)");
    for (const job of others.slice(0, OTHER_JOBS_CAP))
      lines.push(`- ${job.name} — ${job.url || "(no URL)"}`);
    if (others.length > OTHER_JOBS_CAP)
      lines.push(`- +${others.length - OTHER_JOBS_CAP} more, see the run on the forge`);
  }

  lines.push("", `### Files changed by this ${input.changeRequestLabel} (this IS your diff)`);
  if (input.files === null) {
    lines.push(
      "NOT AVAILABLE — the diff could not be read from the forge. Get it yourself with " +
        "`git diff origin/<base>...HEAD --name-status` before judging what is in your scope.",
    );
  } else if (input.files.length === 0) {
    lines.push("(none reported — read the diff yourself before judging what is in your scope)");
  } else {
    for (const f of input.files.slice(0, FILES_CAP)) lines.push(`- ${f.path} (${f.status})`);
    if (input.files.length > FILES_CAP)
      lines.push(`- +${input.files.length - FILES_CAP} more files`);
  }

  lines.push(
    "",
    "### Scope — what is yours to fix, and what is not",
    "1. You fix what YOUR diff broke. The files listed above are your diff.",
    '2. PROOF MUST BE POSITIVE. "The failing test is not in my diff" proves NOTHING: a change in ' +
      "`UserService` legitimately breaks `OrderTest` — the coupling exists. What proves a failure " +
      "is not yours is the SAME job red ON THE BASE BRANCH (look at the base branch's own runs on " +
      "the forge), or an execution path that provably never reaches your diff. Without one of " +
      "those two, treat the failure as yours and fix it.",
    "3. OUT OF SCOPE IS NOT SILENCE. You do not fix it, but you DO file a task with " +
      "`propose_task` naming the job, carrying the positive proof above, and you write it in your " +
      'report. "It was already broken" is not a diagnosis.',
    "",
    "### You are allowed to change nothing",
    "If everything is out of scope — or the failure is an infrastructure outage, a dead runner, a " +
      "flake — finish WITHOUT any code change: the tasks you filed and your written findings ARE " +
      "the deliverable. Do not invent a fix to justify this session.",
    "",
    "### Two prohibitions",
    "- Never disable, skip, or delete the failing test to make the job green.",
    "- Never widen a `catch`, loosen an assertion or relax a threshold to make it pass.",
  );
  return lines.join("\n");
}

/** The refusal when the CI is no longer red on re-probe. It lives next to the block because it says
 *  the same thing inside out: what each state allows. `"failing"` is absent, the only state that
 *  refuses nothing. */
export function ciRefusal(state: CheckState, changeRequestLabel: string, number: number): string {
  const what = `the CI of ${changeRequestLabel} #${number}`;
  if (state === CHECK_STATE.passing) return `${what} is no longer failing — nothing to fix`;
  if (state === CHECK_STATE.pending)
    return `${what} has not finished running — try again once it has a verdict`;
  return `the state of ${what} is unknown (token without the right to read runs, or no check attached) — nothing is launched on an uncertainty`;
}
