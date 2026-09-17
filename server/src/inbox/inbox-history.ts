// A task's inbox history (for the channel view and discussion mode, 25/08).
//
// `listOpenInbox` (inbox.ts) returns only open entries, the human queue that web/src/inbox/
// depends on. This module returns a task's conversation: what the agent asked and what the human
// answered, in order.
//
//  - All statuses (open, answered, closed), sorted by `createdAt` then `rowid`: a conversation
//    must not skip the open question, nor one closed unanswered (`closeSessionInbox`).
//  - Filtered by `taskId`, never `sessionId`: the timeline crosses resumes and reruns.
//  - Failure diagnostics (`createDiagnosticInbox`) are part of the thread; excluding them would
//    leave a silent gap exactly when it matters.
//  - `formData` has no column: a form answer is serialised into `answerText` by
//    `serializeFormAnswer` (inbox-form.ts), and this module reparses it when
//    `kind === INBOX_KIND.form`, with the exact keys `validateFormAnswer` wrote.
import type { FormSpec } from "./inbox-form.js";
import { type AnsweredBy, INBOX_KIND, INBOX_STATUS } from "./inbox-enums.js";
import {
  agentNameById,
  inboxRowsOfTask,
  taskNameStatusById,
  type InboxMessageRow,
} from "./inbox-history-store.js";

export type InboxHistoryAnswer = {
  answeredBy: AnsweredBy | null;
  answeredAt: number | null;
  selectedChoiceId: string | null;
  /** Raw stored text: the chosen label (choice), free text (text), or serialised JSON (form; see
   *  `formData`). */
  text: string;
  /** Non-null only on an answered form: normalised answers per field, `<id>__note` comments
   *  included (inbox-form.ts:noteKey). */
  formData: Record<string, unknown> | null;
};

export type InboxHistoryEntry = {
  id: string;
  sessionId: string;
  kind: InboxMessageRow["kind"];
  body: string;
  evidence: string | null;
  impact: string | null;
  choices: { id: string; label: string }[] | null;
  form: FormSpec | null;
  status: InboxMessageRow["status"];
  /** ON_ANSWER.retryTask = post-failure diagnostic (createDiagnosticInbox): the answer reruns the
   *  task rather than a live session, which the channel may render differently. */
  onAnswer: InboxMessageRow["onAnswer"];
  agentName: string;
  waitForTaskId: string | null;
  waitForTaskName: string | null;
  waitForTaskStatus: string | null;
  wakeAt: number | null;
  createdAt: number;
  /** Null while open, or when closed without an answer (`closeSessionInbox`). */
  answer: InboxHistoryAnswer | null;
};

/** Rebuilds a form's answers from `answerText`, the exact value the session received on resume. */
function parseFormAnswer(row: InboxMessageRow): Record<string, unknown> | null {
  if (row.status !== INBOX_STATUS.answered || row.kind !== INBOX_KIND.form || !row.answerText)
    return null;
  try {
    return JSON.parse(row.answerText) as Record<string, unknown>;
  } catch {
    // Should never happen (serializeFormAnswer writes valid JSON), but a corrupt entry must not
    // break the task's whole history: it keeps its raw text.
    return null;
  }
}

function waitForTaskFields(
  row: InboxMessageRow,
  waitForTask: { name: string; status: string } | null | undefined,
): Pick<InboxHistoryEntry, "waitForTaskId" | "waitForTaskName" | "waitForTaskStatus"> {
  if (!row.waitForTaskId)
    return { waitForTaskId: null, waitForTaskName: null, waitForTaskStatus: null };
  return {
    waitForTaskId: row.waitForTaskId,
    waitForTaskName: waitForTask?.name ?? "task deleted",
    waitForTaskStatus: waitForTask?.status ?? null,
  };
}

function historyAnswerOf(
  row: InboxMessageRow,
  formData: Record<string, unknown> | null,
): InboxHistoryAnswer | null {
  if (row.status !== INBOX_STATUS.answered) return null;
  return {
    answeredBy: row.answeredBy,
    answeredAt: row.answeredAt?.getTime() ?? null,
    selectedChoiceId: row.selectedChoiceId,
    text: row.answerText ?? "",
    formData,
  };
}

/** Pure: turns an `inbox_messages` row (plus the agent name and wait target resolved by the
 *  caller) into a history entry. */
export function toHistoryEntry(
  row: InboxMessageRow,
  ctx: { agentName: string; waitForTask?: { name: string; status: string } | null },
): InboxHistoryEntry {
  const formData = parseFormAnswer(row);
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind,
    body: row.body,
    evidence: row.evidence,
    impact: row.impact,
    choices: row.choices ? (JSON.parse(row.choices) as { id: string; label: string }[]) : null,
    form: row.form ? (JSON.parse(row.form) as FormSpec) : null,
    status: row.status,
    onAnswer: row.onAnswer,
    agentName: ctx.agentName,
    ...waitForTaskFields(row, ctx.waitForTask),
    wakeAt: row.wakeAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    answer: historyAnswerOf(row, formData),
  };
}

/** A task's conversation: every inbox entry of every session, in chronological order. */
export function listTaskInboxHistory(taskId: string): InboxHistoryEntry[] {
  const rows = inboxRowsOfTask(taskId);

  const agentIds = [...new Set(rows.map((r) => r.agentId))];
  const agentNames = new Map(agentIds.map((id) => [id, agentNameById(id) ?? "?"]));

  const waitTaskIds = [
    ...new Set(rows.map((r) => r.waitForTaskId).filter((id): id is string => !!id)),
  ];
  const waitTasks = new Map(waitTaskIds.map((id) => [id, taskNameStatusById(id)] as const));

  return rows.map((row) =>
    toHistoryEntry(row, {
      agentName: agentNames.get(row.agentId) ?? "?",
      waitForTask: row.waitForTaskId ? (waitTasks.get(row.waitForTaskId) ?? null) : null,
    }),
  );
}

export type TaskDecisionAnswer = { text: string; answeredAt: number };

/** For a rerun's brief (task-decisions.ts): only human answers to the agent's questions. The
 *  question itself is dropped; giving it back would return the agent its own words.
 *
 *  `"system"` answers from `wakeDueQuotaPauses` (quota-pause.ts) are excluded: an automatic
 *  wake-up is not an operator decision, and injecting it would be noise that looks like an
 *  instruction. */
export function humanAnsweredInboxOf(taskId: string): TaskDecisionAnswer[] {
  const out: TaskDecisionAnswer[] = [];
  for (const e of listTaskInboxHistory(taskId)) {
    if (e.answer && e.answer.answeredBy === "human")
      out.push({ text: e.answer.text, answeredAt: e.answer.answeredAt ?? e.createdAt });
  }
  return out;
}
