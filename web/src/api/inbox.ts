import { json, patch, post } from "./client.js";
import type { Task } from "./tasks.js";

/** v31 inbox form: N questions in ONE pause. The agent declares the schema and the server validates
 *  it (inbox-form.ts); the screen RENDERS it without revalidating (apart from gating required
 *  fields before sending, a convenience). */
export type FormField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "radio" | "checkbox";
  required?: boolean;
  options?: { id: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
  /** The agent's recommendation, prefilled on the control. It decides nothing: it says where the
   *  agent would start, which spares seven cold decisions. */
  default?: string | number | boolean;
};
export type FormBlock =
  | { kind: "markdown"; text: string }
  | { kind: "svg"; svg: string; caption?: string }
  | { kind: "field"; field: FormField };
export type FormSpec = { blocks: FormBlock[] };
/** Key of the round comment in `formData` (07/09), mirror of `FORM_COMMENT_KEY`
 *  (server/src/inbox/inbox-form.ts). One comment for all answers, typed at the recap; it travels in
 *  the same JSON and the agent reads it in its resume prompt. */
export const FORM_COMMENT_KEY = "__comment";
export type InboxItem = {
  id: string;
  kind: "text" | "choice" | "form";
  body: string;
  /** Action receipt: what the agent read (`evidence`) and what the answer will touch (`impact`).
   *  Null on a question asked before v16 or by an agent that does not fill them: display must hold
   *  without them. */
  evidence: string | null;
  impact: string | null;
  choices: { id: string; label: string }[] | null;
  /** v31. Non-null on a form question, rendered with inbox/inbox-form.tsx. */
  form: FormSpec | null;
  taskId: string;
  taskName: string;
  agentName: string;
  sessionId: string;
  createdAt: number;
  /** The task's project (07/09). The queue is GLOBAL and a question's page lives under its project
   *  (`/p/:projectId/inbox/:inboxId`): without this the list could not build its links. Empty if
   *  the task is gone. */
  projectId: string;
  /** v28. Non-null on an out-of-quota pause: the session sleeps and the scheduler wakes it ALONE at
   *  that time (window reset + margin). Answering wakes it earlier, a safety valve, not the path.
   *
   *  `waitForTask*` (v26): non-null when the item is not a question but a wait set by
   *  `wait_for_task`: the session wakes ALONE when that task is done (answering wakes it earlier).
   *  `waitForTaskStatus` stays `null` if the target vanished without a wake-up (hand-repaired
   *  database). */
  wakeAt: number | null;
  waitForTaskId: string | null;
  waitForTaskName: string | null;
  waitForTaskStatus: Task["status"] | null;
  /** v57. WHY the session waits. One status (`waiting`) covered six situations, and the screen
   *  could only tell them apart by reading the body: an operator pause announced itself as "an
   *  agent is asking you a question". Always set: the server derives it for older items. Mirror of
   *  `WAIT_REASONS` (server/src/inbox/wait-reason.ts). */
  reason: WaitReason;
  /** v62 (07/09). Round progress without its draft. `answered / total` is the "2 / 6" shown by the
   *  card, the inbox list and the waiting panel: three separate counts would have diverged on an
   *  unticked box. `total` is 0 on a text or choice question, answered in place.
   *
   *  `draft` carries the values because the card LISTS what is already decided, which tells whether
   *  resuming now is worth it. The cost is bounded: the queue holds only open items and a form caps
   *  at twelve fields. `draftAt` feeds "draft 12 min ago". */
  answered: number;
  total: number;
  draft: Record<string, unknown> | null;
  draftAt: number | null;
  /** The round number within its interview, 1-based. `null` on a notice (a task wait, a pause):
   *  not a round, so no number.
   *
   *  Computed by the server, and it must be: the rule that skips notices reads the reason of every
   *  item of the task, closed ones included, which the screen does not have. Copying it here showed
   *  "round 3" on an interview that had two. */
  roundIndex: number | null;
};

/** The eight wait reasons. Iterable: `INBOX_TEXT.reason` indexes their labels. Mirror of
 *  `WAIT_REASONS` (server/src/inbox/wait-reason.ts). */
export const WAIT_REASONS = [
  "question",
  "approval",
  "dependency",
  "quota-pause",
  "operator-pause",
  "update-pause",
  "diagnostic",
  // 10/09, inertia pause (`sessions/turn-relaunch.ts`): the session used up its turn budget WHILE
  // progressing, and restarts by itself on the next tick. Nobody is awaited.
  "turn-relaunch",
] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

/** What is asked of the human, mirror of `INBOX_KIND` (server/src/inbox/inbox-enums.ts). Decides
 *  the RENDERING: a form asks N questions in one pause (v31). */
export const INBOX_KIND = { text: "text", choice: "choice", form: "form" } as const;
export const INBOX_KINDS = [INBOX_KIND.text, INBOX_KIND.choice, INBOX_KIND.form] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** `closed` is NOT `answered`: nobody answered, the session stopped while waiting. Mixing them up
 *  would suggest a decision never made. */
export const INBOX_STATUS = { open: "open", answered: "answered", closed: "closed" } as const;
export const INBOX_STATUSES = [
  INBOX_STATUS.open,
  INBOX_STATUS.answered,
  INBOX_STATUS.closed,
] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** `retry-task` relaunches the TASK, not the session: a diagnostic is asked after a failure, so on
 *  an already dead session. */
export const ON_ANSWER = { resume: "resume", retryTask: "retry-task" } as const;
export type OnAnswer = (typeof ON_ANSWER)[keyof typeof ON_ANSWER];

/** `system` = automatic wake-up (a dependency finished, a quota time came). */
export const ANSWERED_BY = { human: "human", system: "system" } as const;
export type AnsweredBy = (typeof ANSWERED_BY)[keyof typeof ANSWERED_BY];

/** A task's archive: all its questions, every status, across sessions.
 *
 *  `/api/inbox` only returns OPEN questions (the human queue), so an answered question disappears
 *  with its context: the offered choices, the evidence, the announced impact. The channel thread
 *  replayed past questions from EVENTS (`inbox_ask`/`inbox_answer`), which carry only two texts and
 *  do not say what you had ruled out or relied on. That is what this archive returns. */
export type InboxHistoryAnswer = {
  answeredBy: "human" | "system" | null;
  answeredAt: number | null;
  selectedChoiceId: string | null;
  text: string;
  formData: Record<string, unknown> | null;
};

export type InboxHistoryEntry = {
  id: string;
  sessionId: string;
  kind: InboxItem["kind"];
  body: string;
  evidence: string | null;
  impact: string | null;
  choices: { id: string; label: string }[] | null;
  form: FormSpec | null;
  status: "open" | "answered" | "closed";
  /** `retry-task` = a DIAGNOSTIC question asked after a failure: the answer relaunches the task. A
   *  legitimate exchange of the thread, worth recognising as such on rereading. */
  onAnswer: "resume" | "retry-task";
  agentName: string;
  waitForTaskId: string | null;
  waitForTaskName: string | null;
  waitForTaskStatus: string | null;
  wakeAt: number | null;
  createdAt: number;
  /** `null` while open, or if CLOSED without an answer (session stopped while waiting). Neither
   *  case is "answered". */
  answer: InboxHistoryAnswer | null;
};

/** One interview round, as the page's round bar draws it. Deliberately thin: the bar shows five,
 *  and loading five forms to draw five dots would be absurd. Its POSITION in
 *  `InboxQuestionDetail.rounds` gives "Round i of n", computed by the server, never a column (see
 *  wiki produit/decisions.md, 07/09). */
export type InboxRound = {
  id: string;
  body: string;
  status: InboxStatus;
  createdAt: number;
  answeredAt: number | null;
  /** 0 on a text or choice question: a round without a questionnaire is still a round. */
  fieldCount: number;
  answeredCount: number;
};

/** A single question (07/09), served by `/api/inbox/:id` for its dedicated page.
 *
 *  Why another route: `/api/inbox` is a QUEUE of open items, so the READ page would be empty once
 *  answered; and `/api/tasks/:id/inbox-history` returns a task's whole conversation to show one
 *  entry. */
export type InboxQuestionDetail = {
  id: string;
  kind: InboxKind;
  status: InboxStatus;
  body: string;
  evidence: string | null;
  impact: string | null;
  choices: { id: string; label: string }[] | null;
  form: FormSpec | null;
  reason: WaitReason;
  sessionId: string;
  createdAt: number;
  /** Decided and not yet sent. Always null on an answered item: `reply` clears it, otherwise the
   *  card would say "2 / 6 · Resume" on a round already sent. */
  draft: Record<string, unknown> | null;
  draftAt: number | null;
  answer: {
    /** Answers reparsed from `answer_text`, the exact value the session received on resume. Null
     *  on a text or choice question, whose answer is not JSON. */
    formData: Record<string, unknown> | null;
    text: string;
    answeredAt: number | null;
    answeredBy: AnsweredBy | null;
  } | null;
  task: { id: string; name: string; projectId: string; status: string } | null;
  agent: { name: string } | null;
  rounds: InboxRound[];
};

export const inboxApi = {
  inbox: (): Promise<InboxItem[]> => fetch("/api/inbox").then(json),
  /** What is STOPPED per project, for the icon rail badge. Every project is present, at zero if it
   *  waits for nothing (server/src/inbox/pending-by-project.ts). */
  pendingByProject: (): Promise<Record<string, number>> =>
    fetch("/api/inbox/pending-by-project").then(json),
  /** ONE task's archive. Distinct from `inbox()`, which stays the queue. */
  taskHistory: (taskId: string): Promise<InboxHistoryEntry[]> =>
    fetch(`/api/tasks/${taskId}/inbox-history`).then(json),
  notices: (): Promise<{ id: string; kind: string; body: string; createdAt: string }[]> =>
    fetch("/api/notices").then(json),
  markNoticeRead: (id: string) => post(`/api/notices/${id}/read`),
  replyInbox: (
    id: string,
    body: { choiceId?: string; text?: string; formData?: Record<string, unknown> },
  ) => post(`/api/inbox/${id}/reply`, body),
  question: (id: string): Promise<InboxQuestionDetail> => fetch(`/api/inbox/${id}`).then(json),
  /** `PATCH`, not `POST`: it modifies an existing item without accomplishing anything (answering is
   *  `replyInbox`). A 409 surfaces as an `Error`: the question was answered elsewhere while typing,
   *  and the page switches to read mode. */
  saveDraft: (
    id: string,
    formData: Record<string, unknown>,
  ): Promise<{ ok: true; answered: number; total: number }> =>
    patch(`/api/inbox/${id}/draft`, { formData }),
};
