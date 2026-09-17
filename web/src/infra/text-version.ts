// The text of the Version card. Kept apart from the rest of `infra` because it is another
// subject: this card does not describe Docker, it describes the code that is running.
import { defineText } from "../i18n/catalog.js";
import type { RuntimeMode } from "../api/version.js";

export const VERSION_TEXT = defineText({
  title: "Version",
  loading: "Reading the version…",
  /** WHERE IT RUNS, said once, plainly. Without this line, an operator in front of a server read
   *  « detached HEAD » and went looking for a git clone in a container that has none. */
  mode: (m: RuntimeMode) => (m === "docker" ? "Docker container" : "git clone"),
  upToDate: "Up to date",
  available: (tag: string) => `${tag} available`,
  /** The gesture that clears the `sessions` blocker, and that SAYS what it does. A neutral
   *  « Update » here would stop agents mid-work without naming it. */
  suspendAndUpdate: (n: number) =>
    n === 1 ? "Suspend the session and update" : `Suspend the ${n} sessions and update`,
  suspendHint:
    "Each session finishes its turn, pushes its work, then starts again on its own once the update is done.",
  /** There is NO MORE « Impossible » pill. It said a final word about a state that resolves on
   *  its own — a session that ends, a commit that gets tagged. The pill says what IS (a version
   *  exists), the note says what stops you from going there right now. */
  ahead: "Ahead",
  unknown: "Unknown",
  /** What is running. Three shapes, because there are three real states: on a tag, AFTER a tag,
   *  and no tag anywhere. Batch 89 confused the last two and showed « no tag » on a repository
   *  that had one, one commit behind. */
  running: (v: {
    current: string | null;
    lastTag: string | null;
    ahead: number;
    branch: string | null;
    sha: string;
  }) => {
    if (v.current) return `${v.current} · ${v.sha}`;
    const where = `${v.branch ?? "detached"} · ${v.sha}`;
    return v.lastTag ? `${where} · ${v.ahead} commit(s) after ${v.lastTag}` : `${where} · no tag`;
  },
  /** The « I am developing » case: normal, not a failure, but it has to be SAID — otherwise
   *  « Up to date » would suggest the running code is the last published version. */
  aheadNote: (n: number, tag: string) =>
    `The running code is ${n} commit(s) after ${tag}: it is unreleased. Set the next tag with « VERSION=vX.Y.Z make release » when it is ready.`,
  step: (from: string | null, to: string) => (from ? `${from} → ${to}` : `→ ${to}`),
  commits: (n: number) => `${n} commit(s)`,
  andMore: (n: number) => `and ${n} more`,
  update: "Update",
  starting: "Starting…",
  /** After the click: what is about to happen, including that the screen will go quiet. In Docker
   *  mode the sentence gains a second witness, and that is not zeal: the ephemeral container
   *  refuses before opening the log if the clone path is wrong, and its message can then only
   *  come out through `docker logs`. Without this line, that case would be a file that does not
   *  exist. */
  startedTitle: "Update started",
  startedBody: (logPath: string, mode: RuntimeMode) =>
    `The control plane is about to restart, so this page will say nothing for a while. Everything is written to ${logPath}.` +
    (mode === "docker"
      ? " If that file stays empty, « docker logs -f legion-update » on the host says why."
      : ""),
  /** The never-tagged repository: do not let it look like a failure. */
  noTags:
    "No tag on the repository: there is nothing to compare. Set the first one with « VERSION=v0.1.0 make release ».",
  unreachable: "GitHub unreachable: cannot tell whether a newer version exists.",
  recheck: "Check now",

  // ────── FOLLOWING THE UPDATE ──────────────────────────────────────
  /** Phase 1: the server still answers, the update is running. */
  updateInProgress: (target: string) => `Updating to ${target}…`,
  /** Phase 2: the server restarts, API calls fail (expected). */
  updateRestarting: "The server is restarting…",
  /** Phase 3a: the server comes back with the right version. */
  updateComplete: (target: string) => `Back on ${target}`,
  updateCompleteNote: "The screen reloads when you click.",
  updateReload: "Reload",
  /** Phase 3b: the server comes back on a different version — the update missed its target. */
  updateMismatch: (current: string, target: string) =>
    `The update stopped: ${current} instead of ${target}`,
  updateMismatchNote: (logPath: string) => `Read the log in ${logPath} to find out why.`,
  /** Phase 4: beyond 10 minutes, something is wrong. */
  updateTimeout: (minutes: number) =>
    `This is taking too long — ${minutes} minutes without an answer`,
  updateTimeoutNote: "Read « docker logs -f legion-update » on the host to diagnose it.",
  /** Two ways out of a failed update: replay the same gesture, or forget it and start over. */
  updateRetry: "Retry",
  updateStartOver: "Start over",

  // ────── THE GLOBAL SIGNAL (02/09): the bar during, the banner after ──────
  // The « running » pill lives in `app/text/shell.ts` (topbar.updating): it is composed with the
  // other indicators of the MACHINE, it does not belong to this panel.
  /** The global banner, on the first return with a version different from the one known when the
   *  page loaded — anywhere in the app, not only here. NO automatic reload (decision #57): a
   *  screen that reloads itself while you are reading is a surprise, the gesture stays a click. */
  returnedTitle: (tag: string) => `${tag} has landed`,
  returnedReload: "Reload",
});
