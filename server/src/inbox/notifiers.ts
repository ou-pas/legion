// The notifier registry, split from the service (06/09) so modules that cannot import `inbox.ts`
// can import it. It knows only the shape of a created entry and who wants to hear about it
// (Discord; Web Push is an output of `notifyOut`, not a notifier). `inbox.ts` re-exports it.
import type { InboxKind } from "./inbox-enums.js";
import { logNotifierFailure } from "./notifiers-store.js";

export type InboxCreated = {
  id: string;
  kind: InboxKind;
  body: string;
  choices: { id: string; label: string }[] | null;
  blocking: boolean;
  taskName: string;
  agentName: string;
  /** v26: the entry waits for a task (wait-for-task.ts), not only a human. The system answers when
   *  that task is done; the human may answer first. */
  waitForTaskId?: string | null;
};

type Notifier = {
  notifyInbox: (msg: InboxCreated) => Promise<void>;
  notifyAnswered?: (inboxId: string, answer: string) => Promise<void>;
  notifyText?: (text: string) => Promise<void>; // free text (standup) to Discord
};

const notifiers: Notifier[] = [];

export function registerNotifier(n: Notifier): void {
  notifiers.push(n);
}

/** Announces a newly created entry, fire-and-forget: a Discord outage must not stop the question
 *  from existing. */
export function notifyInboxCreated(created: InboxCreated): void {
  for (const n of notifiers)
    void n
      .notifyInbox(created)
      .catch((e: unknown) => logNotifierFailure(created.id, String((e as Error)?.message ?? e)));
}

/** Announces an entry was answered, so the channel message can be removed. */
export function notifyInboxAnswered(inboxId: string, answer: string): void {
  for (const n of notifiers) void n.notifyAnswered?.(inboxId, answer).catch(() => {});
}

/** Broadcasts free text to every notifier supporting it (standup). */
export function broadcastText(text: string): void {
  for (const n of notifiers) void n.notifyText?.(text).catch(() => {});
}

/** True if at least one notifier can show free text (e.g. Discord configured). */
export function hasTextNotifier(): boolean {
  return notifiers.some((n) => typeof n.notifyText === "function");
}
