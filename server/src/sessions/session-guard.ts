// The blocked-session invariant (slice nav/11): one place, called by every write path.
//
// A `blocked` session is stopped on a decision that belongs to the human: it asks for the right to
// do something. Injecting text there is answering in their place. The day a reviewer's remarks flow
// back to the worker on their own, "which session may I write into" will come up at every turn, and
// a guard copied into each caller is a guard lost by the third slice.
//
// Hence the check is made INSIDE the write gesture (`enqueueSteer`, `resumeSession`), not in the
// route calling it. A new write path, written by someone unaware `blocked` exists, is refused
// anyway.
//
// `source` defaults to `"system"`: a caller that does not name itself IS automation until proven
// otherwise. Only an explicit `"human"` passes, because the human answer is exactly what unblocks
// the session.
import { sessionStatus } from "./session-guard-store.js";

/** "human" = the operator, from the UI or Discord; "system" = everything else (dependency wake-up,
 *  out-of-quota resume, and the upcoming review loop). */
export type WriteSource = "human" | "system";

/** NAMED. A bare 409 would make the caller guess, and an automatic loop that guesses retries. */
export const BLOCKED_WRITE_REFUSAL =
  "session blocked: it is stopped on an approval decision that belongs to the human — " +
  "an automation does not write there, it waits for the decision to be made";

/** Its own type so the caller can answer 409 rather than 500 without comparing strings. */
export class BlockedSessionError extends Error {
  constructor(message = BLOCKED_WRITE_REFUSAL) {
    super(message);
    this.name = "BlockedSessionError";
  }
}

/** Separate from `assert…` for callers returning an HTTP code instead of letting an exception pass.
 *
 *  The status is reread from the database RIGHT BEFORE the write. Rereading is the point: a status
 *  read at the start of a request may have changed meanwhile, exactly the race being refused. */
export function blockedWriteRefusal(
  sessionId: string,
  source: WriteSource = "system",
): string | null {
  if (source === "human") return null;
  return sessionStatus(sessionId) === "blocked" ? BLOCKED_WRITE_REFUSAL : null;
}

/** Throws `BlockedSessionError` when the write is not allowed. An unknown session is not this
 *  guard's business: the caller already has its own 404. */
export function assertSessionWritable(sessionId: string, source: WriteSource = "system"): void {
  const refusal = blockedWriteRefusal(sessionId, source);
  if (refusal) throw new BlockedSessionError(refusal);
}
