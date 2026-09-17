// Persistence behind `diagnostics.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { INBOX_STATUS, ON_ANSWER } from "./inbox-enums.js";
export { closeInboxMessage } from "./session-close-store.js";

export function taskWithAssignee(taskId: string) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function lastSessionOfTask(taskId: string) {
  return db.select().from(schema.sessions).where(eq(schema.sessions.taskId, taskId)).all().pop();
}

export function agentById(agentId: string) {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

export function insertInboxMessage(msg: typeof schema.inboxMessages.$inferInsert): void {
  db.insert(schema.inboxMessages).values(msg).run();
}

export type StaleDiagnosticRow = typeof schema.inboxMessages.$inferSelect;

export function openRetryDiagnosticsOfTask(taskId: string): StaleDiagnosticRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        eq(schema.inboxMessages.taskId, taskId),
        eq(schema.inboxMessages.status, INBOX_STATUS.open),
        eq(schema.inboxMessages.onAnswer, ON_ANSWER.retryTask),
      ),
    )
    .all();
}

export function insertTaskActivity(row: typeof schema.taskActivity.$inferInsert): void {
  db.insert(schema.taskActivity).values(row).run();
}
