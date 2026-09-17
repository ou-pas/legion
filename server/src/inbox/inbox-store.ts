// Persistence behind `inbox.ts`.
import { eq } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";
import { INBOX_STATUS, type AnsweredBy } from "./inbox-enums.js";

export type InboxMessageRow = typeof schema.inboxMessages.$inferSelect;
export type InboxMessageInsert = typeof schema.inboxMessages.$inferInsert;
type SessionStatus = typeof schema.sessions.$inferSelect.status;

export function sessionById(id: string) {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
}

export function taskById(id: string) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

export function isDemoProjectTask(taskId: string): boolean {
  const task = taskById(taskId);
  return !!task && isDemoProject(task.projectId);
}

export function agentById(id: string) {
  return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
}

export function insertInboxMessageRow(msg: InboxMessageInsert): void {
  db.insert(schema.inboxMessages).values(msg).run();
}

export function setSessionStatus(sessionId: string, status: SessionStatus): void {
  db.update(schema.sessions).set({ status }).where(eq(schema.sessions.id, sessionId)).run();
}

export function inboxMessageById(id: string): InboxMessageRow | undefined {
  return db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, id)).get();
}

/** A task's latest session, to judge a stale failure diagnostic. */
export function latestSessionOfTask(taskId: string) {
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .all()
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
}

export function markInboxMessageAnswered(
  id: string,
  fields: { selectedChoiceId: string | null; answerText: string; answeredBy: AnsweredBy },
): void {
  db.update(schema.inboxMessages)
    .set({
      status: INBOX_STATUS.answered,
      selectedChoiceId: fields.selectedChoiceId,
      answerText: fields.answerText,
      answeredBy: fields.answeredBy,
      answeredAt: new Date(),
      draft: null,
      draftAt: null,
    })
    .where(eq(schema.inboxMessages.id, id))
    .run();
}

export function reopenInboxMessage(
  id: string,
  draft: { draft: string | null; draftAt: Date | null },
): void {
  db.update(schema.inboxMessages)
    .set({
      status: INBOX_STATUS.open,
      selectedChoiceId: null,
      answerText: null,
      answeredBy: null,
      answeredAt: null,
      draft: draft.draft,
      draftAt: draft.draftAt,
    })
    .where(eq(schema.inboxMessages.id, id))
    .run();
}

export function allInboxMessageRows(): InboxMessageRow[] {
  return db.select().from(schema.inboxMessages).all();
}
