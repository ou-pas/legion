// The pause requested by the human (26/08, operator's request: a pause button or signal, agents
// stop gently, save their progress, and can resume when started again).
//
// This module invents no mechanism, which is the point. The pause has existed since Phase 2:
// container destroyed (zero cost), `sdkSessionId` kept, fresh clone at resume, `resumeCount`
// incremented. What was missing was a TRIGGER on the human side: only the agent could take it, by
// asking an inbox question. The operator only had "stop the session", which cuts dead.
//
// Three decisions, and the third protects against lost work.
//
//  1. A flag, not a status. Between the request and the stop the agent still works; it may even
//     finish its task before reading the request. A "pausing" status would lie about what the
//     session does. The session stays `running` until it stops.
//
//  2. At a turn boundary, never mid-turn. The runtime reads the flag on the steering channel it
//     already polls, and honours it where it already checkpoints. Interrupting a turn would lose
//     the model answer just paid for.
//
//  3. Refused during `committing`, the `git push` phase and the only state where a pause could cost
//     work. The refusal SAYS so instead of returning a bare 409.
import {
  operatorPauseTimes,
  pauseRequestedFlag,
  sessionStatusOf,
  setPauseRequested,
} from "./operator-pause-store.js";
import { publish } from "../shared/events.js";
import { createInboxMessage } from "../inbox/inbox.js";
import { WAIT_REASON } from "../inbox/wait-reason.js";
import { currentRunStartedAt } from "./run-scope.js";
import { SESSION_STATUS } from "./session-terminal.js";

export type PauseRefusal = { status: 404 | 409; error: string };

/**
 * The only state where a pause makes sense is `running`. Returns `null` if allowed, otherwise the
 * refusal to relay as is.
 *
 * PURE (it only takes the status): this feature's security boundary, testable without database or
 * session. Same shape as `steerRefusal` on purpose: both gestures talk to a live session and must
 * refuse alike.
 */
export function pauseRefusal(status: string | null | undefined): PauseRefusal | null {
  switch (status) {
    case "running":
      return null;
    case "starting":
      return {
        status: 409,
        error:
          "the session is starting: its container does not exist yet, and no work is in flight. Use “stop” if you want to cancel it.",
      };
    case "committing":
      return {
        status: 409,
        error:
          "a push is in flight. Interrupting this phase is the only way to lose work with this mechanism: wait a few seconds.",
      };
    case SESSION_STATUS.waiting:
      return {
        status: 409,
        error: "the session is already paused: it is waiting for an answer in the inbox.",
      };
    case "destroyed":
    case "failed":
      return { status: 409, error: "the session is over." };
    default:
      return { status: 404, error: "session not found" };
  }
}

/** Raises the flag. The trace keeps ONE line: a pause request an agent never read (because it
 *  finished first) must stay visible, otherwise one believes they clicked into the void.
 *
 *  One, not a hundred and forty-four (14/09). `suspendActiveSessions` asks again at every loop
 *  round, every two seconds for five minutes, on purpose: a `starting` session refuses the pause
 *  and must be caught when it becomes `running`. But republishing the event each time drowned two
 *  sessions' timelines under 288 identical lines, exactly while trying to understand why the pause
 *  did not arrive.
 *
 *  The flag itself is rewritten on every call: an idempotent `UPDATE`, kept unconditional so a flag
 *  cleared between passes (a resume, a concurrent `clearPause`) is always raised again. What becomes
 *  conditional is the TRACE, not the intent. */
export function requestPause(sessionId: string): PauseRefusal | null {
  const refusal = pauseRefusal(sessionStatusOf(sessionId));
  if (refusal) return refusal;
  const already = pauseRequestedFlag(sessionId);
  setPauseRequested(sessionId, true);
  if (!already) publish(sessionId, "pause_requested", {});
  return null;
}

/** What the steering channel returns to the runtime. */
export function isPauseRequested(sessionId: string): boolean {
  return pauseRequestedFlag(sessionId);
}

export function clearPauseRequest(sessionId: string): void {
  setPauseRequested(sessionId, false);
}

/** The FACT, as opposed to the intent. The runtime publishes `operator_pause` when it honours the
 *  request, just before pushing its work and exiting. Without this event, a session that finished
 *  its task while the pause was requested would be paused for nothing.
 *
 *  Same shape as `quotaRejection`: the persisted trace is read rather than guessing from an exit
 *  code, and likewise only for the CURRENT run (02/09): a pause honoured three runs ago says nothing
 *  about the exit that just happened. */
export function pauseHonored(sessionId: string): boolean {
  const since = currentRunStartedAt(sessionId);
  return operatorPauseTimes(sessionId).some((at) => at >= since);
}

/** Call INSTEAD of `markSessionTerminal` when the session exits cleanly with a requested pause.
 *  The session is still `running` here, which lets `createInboxMessage` hold it: IT sets `waiting`,
 *  publishes `inbox_ask` and notifies. Exactly `pauseForQuota`'s contract, for the same reason: the
 *  rail is not duplicated. */
export function pauseForOperator(sessionId: string): void {
  clearPauseRequest(sessionId);
  createInboxMessage(sessionId, {
    kind: "text",
    body: "Paused at your request. I pushed what I had and stopped at the end of my turn. Answer this entry to resume.",
    impact:
      "Nothing is lost: the work is on the branch, the conversation is preserved, and the resume picks up exactly where I stopped.",
    // v57: the only reason that cannot be inferred. A requested pause carries no dependency,
    // scheduled wake-up or approval: without this word it came out as a QUESTION, and the operator
    // was told an agent had a question for the stop they had just requested.
    reason: WAIT_REASON.operatorPause,
  });
}
