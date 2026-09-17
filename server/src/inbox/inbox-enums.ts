// The four enums of an inbox entry, named like `SESSION_STATUS` and `TASK_STATUS`: kind, status,
// answer effect (`onAnswer`) and, once answered, origin. The wait reason has its own module
// (`wait-reason.ts`) because it carries a derivation rule.
//
// Literals were replaced only inside the inbox domain: `"text"`, `"open"`, `"human"` are common
// words that also appear in JSX props, CSS and labels.
import type { schema } from "../shared/db.js";

type InboxRow = typeof schema.inboxMessages.$inferSelect;

/** What is asked of the human. The kind decides rendering, not urgency: a form asks N questions
 *  in one pause, where three text questions cost three pause → destroy → resume cycles (v31). */
export type InboxKind = InboxRow["kind"];
export const INBOX_KIND = {
  text: "text",
  choice: "choice",
  form: "form",
} as const satisfies Record<string, InboxKind>;
export const INBOX_KINDS = [INBOX_KIND.text, INBOX_KIND.choice, INBOX_KIND.form] as const;

/** `closed` is not `answered`: nobody answered, the session stopped while waiting
 *  (`closeSessionInbox`). Mixing them would suggest a decision that was never taken. */
export type InboxStatus = InboxRow["status"];
export const INBOX_STATUS = {
  open: "open",
  answered: "answered",
  closed: "closed",
} as const satisfies Record<string, InboxStatus>;
export const INBOX_STATUSES = [
  INBOX_STATUS.open,
  INBOX_STATUS.answered,
  INBOX_STATUS.closed,
] as const;

/** What the answer does. `retry-task` reruns the task, not the session: a diagnostic question
 *  follows a failure, on a dead session with nothing to resume (v12). */
export type OnAnswer = InboxRow["onAnswer"];
export const ON_ANSWER = {
  resume: "resume",
  retryTask: "retry-task",
  /** `rebuild-image` (12/09): the answer rebuilds a machine's missing image, and the queue resumes
   *  tasks once the probe sees it back. Rerunning here would throw them at the still-missing
   *  image, the loop this question closes (`inbox/image-rebuild.ts`). */
  rebuildImage: "rebuild-image",
} as const satisfies Record<string, OnAnswer>;

/** Who answered. `system` is the automatic wake-up (a dependency done, a quota reset). `null` in
 *  the database means answered before the column existed; no origin is invented after the fact. */
export type AnsweredBy = NonNullable<InboxRow["answeredBy"]>;
export const ANSWERED_BY = {
  human: "human",
  system: "system",
} as const satisfies Record<string, AnsweredBy>;
