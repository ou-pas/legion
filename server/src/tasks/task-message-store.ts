// The target task, the live session that would absorb the message by steering, and filing the
// message in the activity feed.
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, isDemoProject, schema } from "../shared/db.js";
import { ACTIVE_STATUSES } from "../sessions/session-terminal.js";
import type { ActivityFrom } from "./activity-enums.js";

export { isDemoProject };

export function findTaskRow(taskId: string): typeof schema.tasks.$inferSelect | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

/** Sessions still active on this task: the one to talk to by steering rather than rewriting the
 *  brief under it. */
export function activeSessionsOf(taskId: string): (typeof schema.sessions.$inferSelect)[] {
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.taskId, taskId),
        inArray(schema.sessions.status, [...ACTIVE_STATUSES]),
      ),
    )
    .all();
}

/** The message enters the task's feed, not only its brief (see `task-message.ts`). */
export function recordMessageActivity(taskId: string, from: ActivityFrom, body: string): void {
  db.insert(schema.taskActivity)
    .values({ id: nanoid(10), taskId, from, body, createdAt: new Date() })
    .run();
}
