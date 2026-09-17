// Closing the questions of a stopping session (06/09).
//
// `stopSession` used to repeat this UPDATE by hand instead of calling `closeSessionInbox`. A
// `closed` question is not `answered`: nobody answered it because the session died waiting.
//
// Its own module, like `notices.ts` and `diagnostics.ts`: the runner calls it and may not import
// the answering service.
import {
  closeInboxMessage,
  closeOpenInboxOfSession,
  openInboxIdsOfDeadSessions,
} from "./session-close-store.js";

/** Catch-up (08/09): closes questions still open whose session is already terminal. Only
 *  `stopSession` used to close a session's inbox; the sweep and failures did not, leaving
 *  out-of-quota notices and questions nobody would read ("session is destroyed, not waiting").
 *  Runs at boot and on every sweep. Returns the count closed, for the log. */
export function closeInboxOfDeadSessions(): number {
  const ids = openInboxIdsOfDeadSessions();
  for (const id of ids) closeInboxMessage(id);
  return ids.length;
}

/** Closes any question still open on this session. Idempotent: closed or answered entries are
 *  untouched. */
export function closeSessionInbox(sessionId: string): void {
  closeOpenInboxOfSession(sessionId);
}
