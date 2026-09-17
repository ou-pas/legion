// Reads behind `inbox-history.ts`. `inboxRowsOfTask` also serves `inbox-question.ts`: one query,
// not two.
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type InboxMessageRow = typeof schema.inboxMessages.$inferSelect;

/** A task's rows in arrival order. Millisecond ties break on `rowid` (SQLite's monotonic insert
 *  counter): `id` is a random `nanoid`, and sorting on it was wrong now and then (03/09). */
export function inboxRowsOfTask(taskId: string): InboxMessageRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.taskId, taskId))
    .orderBy(asc(schema.inboxMessages.createdAt), asc(sql`rowid`))
    .all();
}

export function agentNameById(id: string): string | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get()?.name;
}

export function taskNameStatusById(id: string): { name: string; status: string } | null {
  const t = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  return t ? { name: t.name, status: t.status } : null;
}
