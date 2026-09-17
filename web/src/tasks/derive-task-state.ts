// Derives a task's ACTUAL state (observations), independent of its COLUMN (intention). Derived state
// is what the sessions show: success, failure, running, waiting. Stored state (column) is the
// operator's intention: later, todo, doing, review, done.
//
// Why derive rather than store: execution state lives in `sessions.status`, a task has N successive
// sessions, and the server asks that set a single question, is a session still active?
// (`tasks/lifecycle.ts`, `settleTaskAfterSession`). Adding `waiting` to the five task statuses would
// duplicate that fact in a second source to keep in sync on every pause, resume, quota, gate and
// container death. Here nothing to sync: the function reads and never writes.
//
// What the 03/09 pass fixed, four defects of the first version:
//
//  1. `blocked` was not handled. It belongs to the server's `ACTIVE_STATUSES` (a session stopped on
//     an approval gate is ALIVE) but fell into `default` and came out "not-started": a task waiting
//     for the operator's approval showed as never run.
//
//  2. `contradiction` was declared in the type and NEVER returned. The case the original header
//     described ("doing + failed") came out as `failed`, so nothing ever counted it.
//
//  3. `endReason === "stopped"` compared with a value that does not exist. `markSessionTerminal`
//     writes a human SENTENCE meant to be shown ("the agent process exited with code 0", "session
//     stopped by the operator"). The branch was dead, and its neighbour classified every stop as a
//     success. So the sentence is shown as is instead of guessing from it.
//
//  4. A session exiting in SUCCESS without delivering anything passed for a success. Measured on
//     03/09: the SDK returns a `success` `result` carrying "API Error: 529 Overloaded", the process
//     exits 0, the task goes to `review`, and the screen showed the most reassuring state possible
//     on work that produced not a single line.
import { type Session, type SessionStatus } from "../api/sessions.js";
import type { Task } from "../api/tasks.js";
import { SESSION_STATUS } from "../api/sessions.js";
import { TASK_STATUS } from "../api/tasks.js";
import { TASK_CARD_TEXT } from "./text/card.js";

const FACT = TASK_CARD_TEXT.derivedFact;

/** What the derivation reads from a task, and nothing more. `Pick` rather than `Task`: the board list
 *  serves `TaskSummary` (no `description` nor `criteria`, cut of 02/09), and requiring a full `Task`
 *  forced the card to carry a whole record to read two fields. */
type ObservedTask = Pick<Task, "status" | "settledOutcome">;

/** The seven derived states. An ITERABLE list, not just a union: the badge indexes an icon table by
 *  state and the stories render the series; an inline union forced each to copy the list, and a new
 *  state got forgotten in the copy. */
export const DERIVED_TASK_STATES = [
  "not-started",
  "running",
  "paused",
  "blocked",
  "completed",
  "failed",
  "contradiction",
] as const;

/** A task's derived state, computed from its sessions: OBSERVED, distinct from the STORED status
 * (board column).
 *
 * - `not-started`: no session, or the last one did not start.
 * - `running`: session in progress (starting, running, committing).
 * - `paused`: session waiting for an ANSWER (question, pause, quota, diagnosis).
 * - `blocked`: session stopped on an APPROVAL; the operator must decide, not answer.
 * - `completed`: session ended with something to show.
 * - `failed`: session failed.
 * - `contradiction`: the observation contradicts what the column claims.
 */
export type DerivedTaskState = (typeof DERIVED_TASK_STATES)[number];

export interface DerivedState {
  state: DerivedTaskState;
  /** Short sentence explaining the observed fact, for the tooltip and accessibility. */
  fact: string;
}

/** Session statuses where something RUNS. A subset of `ACTIVE_SESSION_STATUSES`: the two other active
 *  statuses (`waiting`, `blocked`) are alive too, but wait for a HUMAN gesture and each deserves its
 *  own badge. */
const RUNNING: readonly SessionStatus[] = ["starting", "running", "committing"];

/** The server's sentence if any, else the fallback. `endReason` is written to be shown: rephrasing it
 *  would lose what the server knows and the screen does not. */
function reasonOr(session: Session, fallback: string): string {
  return session.endReason ?? fallback;
}

/** Derives a task's ACTUAL state from its observations (sessions). Pure function.
 *
 * Decision ORDER matters: what is ALIVE first (a running session beats whatever the column says),
 * then endings, where observation can finally be compared with intention. Looking for a
 * contradiction before seeing the end would flag every task that is starting.
 *
 * @param session the task's LAST session. Enough by construction: an earlier session is necessarily
 *   over, and the most recent carries the current state.
 */
export function deriveTaskState(task: ObservedTask, session: Session | undefined): DerivedState {
  // No session, no execution observation. The column may claim anything, we know nothing, and
  // "nothing" is not a contradiction, it is an absence.
  if (!session) return { state: "not-started", fact: FACT.neverRun };

  if (RUNNING.includes(session.status)) {
    return {
      state: "running",
      fact: session.status === "committing" ? FACT.committing : FACT.running,
    };
  }

  // The two waits, separate because the expected gesture differs: answer, or approve. A `waiting`
  // carries four reasons (question, requested pause, token ceiling, failure diagnosis) and a gate is
  // none of them.
  if (session.status === SESSION_STATUS.waiting) {
    return { state: "paused", fact: FACT.waiting };
  }
  if (session.status === "blocked") {
    return { state: "blocked", fact: FACT.blocked };
  }

  // From here the session is over (`destroyed` or `failed`), so the column's intention becomes
  // comparable with what happened.

  // A task still "doing" with no live session behind it is the lie `settleTaskAfterSession` exists to
  // prevent (bug of 26/08: a task stuck in `doing` forever). If observed anyway, the badge SAYS it
  // instead of smoothing it over.
  if (task.status === TASK_STATUS.doing) {
    return {
      state: "contradiction",
      fact: reasonOr(session, FACT.contradiction),
    };
  }

  if (session.status === "failed") {
    return { state: "failed", fact: reasonOr(session, FACT.failed) };
  }

  // `destroyed`: exit without error. The most misleading case in the system, because an API error is
  // one of them: the SDK returns a success carrying the error text.
  //
  // We read the server's verdict (v56) instead of reconstructing it. The previous version guessed from
  // `prUrls`, which missed everything pushed without a PR and needed an exception for read-only
  // tasks. Settling sees the two real signals (`repo_push` with `changes > 0`, a writing `fs_op`).
  if (task.settledOutcome === "empty") {
    return { state: "contradiction", fact: FACT.empty };
  }
  if (task.settledOutcome === "stopped") {
    return { state: "failed", fact: reasonOr(session, FACT.stopped) };
  }

  return { state: "completed", fact: reasonOr(session, FACT.completed) };
}
