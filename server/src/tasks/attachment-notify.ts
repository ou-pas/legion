// A burst of drops, one message to the agent (07/09, operator's remark: "if we send three files, do
// we steer three times?").
//
// The screen sends files one by one, and the runner drains its steering queue in milliseconds:
// grouping already queued messages would be useless, the first is gone before the second file
// arrives. So the notice is held while the burst passes, then made into one naming every path. The
// price: a second and a half between drop and the agent's turn, invisible next to a model turn.
//
// In memory, per session. A control plane restart during the window loses the notice; the file is
// stored, and the next session's brief names it. `unref` on the timer, as everywhere else: a pending
// notice does not hold the process.
import { createLogger } from "../shared/log.js";
import { enqueueSteer, steerRefusal } from "../sessions/steering.js";
import { sessionStatusOf } from "./attachment-notify-store.js";
import { attachmentSteerText, type Attachment } from "./attachments.js";

const log = createLogger("attachments");

export const ATTACHMENT_NOTIFY_DELAY_MS = 1_500;

const pending = new Map<string, { files: Attachment[]; timer: NodeJS.Timeout }>();

/** Notify the session later, once for everything that arrives until then. */
export function notifyAttachment(
  sessionId: string,
  attachment: Attachment,
  delayMs: number = ATTACHMENT_NOTIFY_DELAY_MS,
): void {
  const entry = pending.get(sessionId);
  if (entry) {
    clearTimeout(entry.timer);
    // The same name dropped again replaces the file on disk (`saveAttachment`), so it also replaces
    // its line in the notice, or the agent would read the same path twice.
    const files = [...entry.files.filter((f) => f.name !== attachment.name), attachment];
    pending.set(sessionId, { files, timer: schedule(sessionId, delayMs) });
    return;
  }
  pending.set(sessionId, { files: [attachment], timer: schedule(sessionId, delayMs) });
}

function schedule(sessionId: string, delayMs: number): NodeJS.Timeout {
  const timer = setTimeout(() => flushAttachmentNotices(sessionId), delayMs);
  timer.unref?.();
  return timer;
}

/** How many notices are held for this session: for the screen and tests, not for deciding. */
export function pendingAttachmentNotices(sessionId: string): number {
  return pending.get(sessionId)?.files.length ?? 0;
}

/** Sends what is held now (one session, or all). A session that ended meanwhile refuses writes
 *  (`assertSessionWritable`): the notice is dropped with a log line, not a throw. The file is there,
 *  the next session will see it. */
export function flushAttachmentNotices(sessionId?: string): void {
  const ids = sessionId ? [sessionId] : [...pending.keys()];
  for (const id of ids) {
    const entry = pending.get(id);
    if (!entry) continue;
    clearTimeout(entry.timer);
    pending.delete(id);
    // Re-read now, not at drop time: in a second and a half the session may have ended, and
    // `enqueueSteer` would write a message nobody comes to fetch.
    const refusal = steerRefusal(sessionStatusOf(id));
    if (refusal) {
      log.warn("attachment(s) not announced: the session is no longer listening", {
        sessionId: id,
        files: entry.files.map((f) => f.name),
        why: refusal.error,
      });
      continue;
    }
    enqueueSteer(id, attachmentSteerText(entry.files), "system");
  }
}
