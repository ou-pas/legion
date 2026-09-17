import { ON_ANSWER } from "./inbox-enums.js";
import type { OnAnswer } from "./inbox-enums.js";
// Why this session waits (03/09).
//
// `waiting` is set only by `createInboxMessage`. `pauseForOperator` also creates an inbox entry,
// because the entry is the resume button (answering resumes the session with its `sdkSessionId`).
// So one status carried several situations the screen could only tell apart by reading the body;
// an operator pause showed up as "an agent is asking you a question".
//
// Most reasons derive from the entry's fields; the operator pause does not, so the caller names
// it.
//
// On the entry, not the session: a session goes through several successive waits, and each entry
// carries exactly one.

/** The wait reasons, as an iterable list: the screen indexes labels by it, so a reason added
 *  without a label shows. */
export const WAIT_REASONS = [
  "question",
  "approval",
  "dependency",
  "quota-pause",
  "operator-pause",
  // 08/09: a suspension nobody asked for. An update restarts the control plane, and the new
  // server must resume these sessions without also waking the ones the operator paused.
  "update-pause",
  "diagnostic",
  // 10/09: the session hit its turn budget while making progress and restarts on its own in a
  // fresh container (`sessions/turn-relaunch.ts`). A scheduler tick, not a human wait, and the
  // resume prompt must not describe an out-of-quota pause.
  "turn-relaunch",
] as const;

export type WaitReason = (typeof WAIT_REASONS)[number];

/** Named reasons, so no caller carries a literal. */
export const WAIT_REASON = {
  question: "question",
  approval: "approval",
  dependency: "dependency",
  quotaPause: "quota-pause",
  operatorPause: "operator-pause",
  updatePause: "update-pause",
  diagnostic: "diagnostic",
  turnRelaunch: "turn-relaunch",
} as const satisfies Record<string, WaitReason>;

/** The entry fields the reason depends on. Structural rather than `InboxRow`, so tests pass only
 *  what decides. */
export type WaitReasonInput = {
  /** Asks for permission to do something, not for information (slice nav/11). */
  approval?: boolean;
  /** The entry waits for another task to finish (`wait_for_task`, v26). */
  waitForTaskId?: string | null;
  /** Scheduled wake-up: out-of-quota pause (v28). */
  wakeAt?: Date | null;
  /** `retry-task` = diagnostic question after a failure: the answer reruns the task, never the
   *  dead session (v12). */
  onAnswer?: OnAnswer;
};

/** The reason derived from the entry's fields. Order matters:
 *
 *   1. dependency and scheduled wake-up first: they exclude approval (a wait that wakes on its own
 *      has nothing to approve; `createInboxMessage` applies the same rule for `waiting` vs
 *      `blocked`);
 *   2. approval, the only reason that changes the session status;
 *   3. diagnostic, recognised by `onAnswer`;
 *   4. question, the default.
 *
 *  An operator pause cannot be derived: no field tells it from a question, so
 *  `pauseForOperator` names it. */
export function deriveWaitReason(input: WaitReasonInput): WaitReason {
  if (input.waitForTaskId) return WAIT_REASON.dependency;
  if (input.wakeAt) return WAIT_REASON.quotaPause;
  if (input.approval) return WAIT_REASON.approval;
  if (input.onAnswer === ON_ANSWER.retryTask) return WAIT_REASON.diagnostic;
  return WAIT_REASON.question;
}

/** Does this reason need an operator gesture? Not for waits that wake on their own, nor for a
 *  pause the operator just asked for. Decides "waiting for you" versus "paused", and whether to
 *  notify. */
export function needsOperator(reason: WaitReason): boolean {
  return (
    reason === WAIT_REASON.question ||
    reason === WAIT_REASON.approval ||
    reason === WAIT_REASON.diagnostic
  );
}
