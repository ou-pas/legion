// A refusal is recognised by its first word, which `lot-refusal.ts` owns: this store returns the
// whole activity feed and searches nothing in it.
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type ActivityRow = typeof schema.taskActivity.$inferSelect;

export function insertTaskActivity(row: typeof schema.taskActivity.$inferInsert): void {
  db.insert(schema.taskActivity).values(row).run();
}

/** A task's activity feed, newest first.
 *
 *  `rowid` breaks ties, not the id: two rows from the same millisecond share `createdAt`, and the
 *  id is a nanoid, so sorting on it made "the last one" random, once in three test runs. SQLite's
 *  `rowid` is insertion order, which is exactly what "the last one" means here. */
export function taskActivityNewestFirst(taskId: string): ActivityRow[] {
  return db
    .select()
    .from(schema.taskActivity)
    .where(eq(schema.taskActivity.taskId, taskId))
    .orderBy(desc(schema.taskActivity.createdAt), desc(sql`rowid`))
    .all();
}
