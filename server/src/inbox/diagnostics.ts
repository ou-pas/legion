// Failure diagnostics: the part of the inbox the runner writes (06/09). Split from `inbox.ts`
// (the answering service) like `notices.ts`: these writes need only the database, the event
// stream and the notifiers, so the runner imports them statically.
import { nanoid } from "nanoid";
import { publish } from "../shared/events.js";
import { ANSWERED_BY, INBOX_KIND, INBOX_STATUS, ON_ANSWER } from "./inbox-enums.js";
import { WAIT_REASON } from "./wait-reason.js";
import { notifyInboxCreated } from "./notifiers.js";
import {
  agentById,
  closeInboxMessage,
  insertInboxMessage,
  insertTaskActivity,
  lastSessionOfTask,
  openRetryDiagnosticsOfTask,
  taskWithAssignee,
} from "./diagnostics-store.js";

/**
 * Diagnostic question (lot 3) after a real task fails: not tied to a live session, the answer
 * reruns the task (onAnswer=retry-task). Never an automatic rerun: the human decides.
 */
export function createDiagnosticInbox(taskId: string, body: string): void {
  const task = taskWithAssignee(taskId);
  if (!task || !task.assigneeAgentId) return;
  const lastSession = lastSessionOfTask(taskId);
  const choices = [
    { id: "retry", label: "Run the task again with this diagnostic" },
    { id: "drop", label: "Leave it in review" },
  ];
  const msg = {
    id: nanoid(10),
    sessionId: lastSession?.id ?? taskId, // reference only; no session is held
    taskId,
    agentId: task.assigneeAgentId,
    kind: INBOX_KIND.choice,
    body,
    choices: JSON.stringify(choices),
    status: INBOX_STATUS.open,
    onAnswer: ON_ANSWER.retryTask,
    reason: WAIT_REASON.diagnostic, // second writer of the table: sets its reason itself
    createdAt: new Date(),
  };
  insertInboxMessage(msg);
  const agent = agentById(task.assigneeAgentId);
  notifyInboxCreated({
    id: msg.id,
    kind: INBOX_KIND.choice,
    body,
    choices,
    blocking: true,
    taskName: task.name,
    agentName: agent?.name ?? "?",
  });
}

/** v30 (0JMcKrp7vg): a failure diagnostic offers to rerun the task, so once the task gets a new
 *  session it is stale; acting on it would start a parallel session or a 409. Closed with a trace
 *  (system activity plus a stream note), never silently. Only diagnostics expire: a real waiting
 *  question holds a live session. */
export function expireStaleDiagnostics(taskId: string, newSessionId: string): void {
  const stale = openRetryDiagnosticsOfTask(taskId).filter((m) => m.sessionId !== newSessionId);
  for (const m of stale) {
    closeInboxMessage(m.id);
    insertTaskActivity({
      id: nanoid(10),
      taskId,
      from: ANSWERED_BY.system,
      body: "Stale failure diagnostic: the task was run again — the question was removed from the inbox.",
      createdAt: new Date(),
    });
    publish(m.sessionId, "inbox_note", { body: "stale diagnostic: the task was run again" });
  }
}
