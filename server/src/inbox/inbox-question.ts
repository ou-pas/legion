// One question, with what is needed to answer or reread it (07/09), for its page
// (`/p/:projectId/inbox/:inboxId`). `/api/inbox` is a queue of open entries only, and
// `/api/tasks/:id/inbox-history` loads the whole conversation to show one entry.
//
// Rounds are computed, never stored: "Round 2 of 3" is the entry's position among its task's
// questions by `created_at`. A position column would go wrong the first time a round arrives out
// of sequence.
//
// Notices are not rounds: waiting for another task, out-of-quota and operator pauses asked nothing
// of anyone. The filter is `needsOperator` (`wait-reason.ts`).
import { answeredCount, parseDraft } from "./inbox-draft.js";
import { type FormSpec } from "./inbox-form.js";
import { INBOX_STATUS, type AnsweredBy, type InboxKind, type InboxStatus } from "./inbox-enums.js";
import { deriveWaitReason, needsOperator, type WaitReason } from "./wait-reason.js";
import { inboxRowsOfTask } from "./inbox-history-store.js";
import { agentById, inboxRowById, taskById, type InboxRow } from "./inbox-question-store.js";

/** A round in the page's navigation bar: enough for "Round 2 · 6 questions" and whether it is
 *  open. Deliberately lean: the bar shows up to five. */
export type InboxRound = {
  id: string;
  body: string;
  status: InboxStatus;
  createdAt: number;
  answeredAt: number | null;
  /** Form field count. `0` for a text or choice question, which still counts as a round. */
  fieldCount: number;
  /** Fields with a value, in the answer if sent, else in the draft. */
  answeredCount: number;
};

/** The entry's reason, derived for rows older than the column (v57). One place, so the filter and
 *  the response cannot diverge. */
const reasonOf = (row: InboxRow): WaitReason =>
  row.reason ??
  deriveWaitReason({
    waitForTaskId: row.waitForTaskId,
    wakeAt: row.wakeAt,
    onAnswer: row.onAnswer,
  });

/** Is this entry an interview round or a notice?
 *
 *  Not redundant: `needsOperator` drops self-waking reasons, and the field checks drop an entry
 *  whose reason stayed `question` (pre-v57, or set by hand) yet carries a wait. The field wins: it
 *  drives the session's real behaviour. */
export const isRoundEntry = (row: InboxRow): boolean =>
  row.waitForTaskId === null && row.wakeAt === null && needsOperator(reasonOf(row));

/** A row's field and answer counts: from `answer_text` (normalised JSON) when answered, from the
 *  draft when open, both through `answeredCount`. */
function countsOf(row: InboxRow): { fieldCount: number; answeredCount: number } {
  const spec = row.form ? (JSON.parse(row.form) as FormSpec) : null;
  const values =
    row.status === INBOX_STATUS.answered ? parseDraft(row.answerText) : parseDraft(row.draft);
  const { answered, total } = answeredCount(spec, values);
  return { fieldCount: total, answeredCount: answered };
}

/** Pure: a task's rounds from its rows, already sorted by the caller. */
export function roundsFrom(rows: readonly InboxRow[]): InboxRound[] {
  return rows.filter(isRoundEntry).map((row) => ({
    id: row.id,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    answeredAt: row.answeredAt?.getTime() ?? null,
    ...countsOf(row),
  }));
}

/** A task's rounds in order (millisecond ties break on `rowid`, see `inboxRowsOfTask`). */
export function roundsOf(taskId: string): InboxRound[] {
  return roundsFrom(inboxRowsOfTask(taskId));
}

/** A round's 1-based number, or `null` for a notice. Read by `listOpenInbox` so the card can say
 *  "round 2": the screen lacks the data, since a closed entry's reason is not in the channel
 *  archive. */
export function roundIndexOf(taskId: string, inboxId: string): number | null {
  const at = roundsOf(taskId).findIndex((r) => r.id === inboxId);
  return at === -1 ? null : at + 1;
}

/** The sent answer as the read-only page shows it. `formData` is reparsed from `answer_text`, the
 *  exact value the session received on resume (as in `inbox-history.ts`). */
export type InboxAnswer = {
  formData: Record<string, unknown> | null;
  text: string;
  answeredAt: number | null;
  answeredBy: AnsweredBy | null;
};

export type InboxQuestion = {
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
  /** The current draft and when it was written. Null when not started, and always null once
   *  answered (`answerInbox` clears it). */
  draft: Record<string, unknown> | null;
  draftAt: number | null;
  answer: InboxAnswer | null;
  task: { id: string; name: string; projectId: string; status: string } | null;
  agent: { name: string } | null;
  /** Interview rounds in order; `id`'s position gives "Round i of n". */
  rounds: InboxRound[];
};

/** The question alone. `null` for an unknown id (the route answers 404). */
export function inboxQuestion(inboxId: string): InboxQuestion | null {
  const row = inboxRowById(inboxId);
  if (!row) return null;
  const task = taskById(row.taskId);
  const agent = agentById(row.agentId);
  const answered = row.status === INBOX_STATUS.answered;

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    body: row.body,
    evidence: row.evidence,
    impact: row.impact,
    choices: row.choices ? (JSON.parse(row.choices) as { id: string; label: string }[]) : null,
    form: row.form ? (JSON.parse(row.form) as FormSpec) : null,
    reason: reasonOf(row),
    sessionId: row.sessionId,
    createdAt: row.createdAt.getTime(),
    draft: parseDraft(row.draft),
    draftAt: row.draftAt?.getTime() ?? null,
    answer: answered
      ? {
          formData: parseDraft(row.answerText),
          text: row.answerText ?? "",
          answeredAt: row.answeredAt?.getTime() ?? null,
          answeredBy: row.answeredBy,
        }
      : null,
    task: task
      ? { id: task.id, name: task.name, projectId: task.projectId, status: task.status }
      : null,
    agent: agent ? { name: agent.name } : null,
    rounds: roundsOf(row.taskId),
  };
}
