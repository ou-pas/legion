// Red CI watch on open PRs (29/09): what a tick decides for ONE PR already selected as watchable
// (task in `review`, project switch on, not the demo project — see `ci-watch-store.ts`). Pure rules,
// no database, no network: the tick (`ci-watch-tick.ts`) reads the CI state and the persisted
// counter, calls this, and only then acts.
//
// Sister of `fixCi` (`review.ts`): the cap exists so the agent cannot loop forever on a failure it
// cannot fix, and the counter resets on green because a regression brought in by a later push is a
// new problem, not the old one persisting.
import { CHECK_STATE, type CheckState } from "../integrations/forge.js";

/** Automatic attempts per PR before the operator is told (operator decision, round 1 — went against
 *  the recommendation of 2, no reason given). */
export const CI_WATCH_CAP = 3;

/** The counter this PR carries between ticks. `attempts` counts successful `fixCi` launches since
 *  the last green CI (a refusal — session active, 409, 502 — does not increment it, see
 *  `CiWatchOutcome`); `notified` guards the once-per-exhaustion rule for `ci_failed`. */
export type CiWatchState = { attempts: number; notified: boolean };

export const INITIAL_CI_WATCH_STATE: CiWatchState = { attempts: 0, notified: false };

/** What a tick decides for a PR, from its CI state and its counter so far:
 *  - `"nothing"`: uncertain (`pending`/`unknown` — never act on uncertainty, like `fixCi` itself) or
 *    exhausted and already notified;
 *  - `"reset"`: CI is green, the counter starts over;
 *  - `"launch"`: CI is red and attempts remain, call `fixCi`;
 *  - `"notify"`: CI is red, the cap is spent, and `ci_failed` was not yet sent for this run of
 *    failures. */
export type CiWatchAction = "nothing" | "reset" | "launch" | "notify";

export function decideCiWatchAction(
  input: { checkState: CheckState; state: CiWatchState },
  cap: number = CI_WATCH_CAP,
): CiWatchAction {
  if (input.checkState === CHECK_STATE.passing) return "reset";
  if (input.checkState !== CHECK_STATE.failing) return "nothing"; // pending or unknown
  if (input.state.attempts < cap) return "launch";
  return input.state.notified ? "nothing" : "notify";
}

/** What actually happened while acting on `"launch"`/`"notify"`, folded into the next counter.
 *  Split from `decideCiWatchAction` because the outcome of a `fixCi` call is not known until it
 *  returns: the decision picks the gesture, the fold records what it produced. */
export type CiWatchOutcome =
  | "green" // checks passing: full reset
  | "fix-launched" // fixCi launched a session: counts as an attempt
  | "fix-refused" // fixCi refused (session active, 409, 502): does not count, retried next tick
  | "notified"; // ci_failed sent: guards against sending it again next tick

export function foldCiWatchState(state: CiWatchState, outcome: CiWatchOutcome): CiWatchState {
  switch (outcome) {
    case "green":
      return INITIAL_CI_WATCH_STATE;
    case "fix-launched":
      return { ...state, attempts: state.attempts + 1 };
    case "fix-refused":
      return state;
    case "notified":
      return { ...state, notified: true };
  }
}

/** The activity line for one automatic attempt (operator decision: on the task, never a
 *  notification — the operator only steps in once the attempts run out). */
export function ciWatchAttemptLine(
  repoName: string,
  number: number,
  attempt: number,
  cap: number = CI_WATCH_CAP,
): string {
  return `CI red on ${repoName}#${number}, automatic attempt ${attempt}/${cap}`;
}

/** Whether a project watches its `review` tasks' CI at all: the per-project switch, off for the
 *  demo project regardless of the column (a read-only sandbox launches nothing). */
export function ciWatchEnabledFor(project: { ciWatch: boolean; demo: boolean }): boolean {
  return project.ciWatch && !project.demo;
}
