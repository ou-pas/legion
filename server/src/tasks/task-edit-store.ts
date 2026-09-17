// No business `if` here: which statuses stay editable is a `lifecycle.ts` decision
// (`EDITABLE_STATUSES`), received as a parameter, as `writeTaskStatus` (`lifecycle-store.ts`)
// receives `requireStatusIn`. Re-checking in the `WHERE` is legitimate; hard-coding the list there
// is not.
import { and, eq, inArray } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";
import type { TaskStatus } from "./lifecycle.js";

export { isDemoProject };

export function findTaskRow(taskId: string): typeof schema.tasks.$inferSelect | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function findAgentRow(agentId: string): typeof schema.agents.$inferSelect | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

/** Sets the given fields, but nothing if the status moved outside `requireStatusIn` since the read
 *  (see `task-edit.ts`): restated in the `WHERE`, not in a separate read. Returns the number of rows
 *  touched; 0 means a lost race. */
export function updateTaskFields(
  taskId: string,
  fields: Partial<typeof schema.tasks.$inferInsert>,
  requireStatusIn: readonly TaskStatus[],
): number {
  return db.transaction(() => {
    const r = db
      .update(schema.tasks)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(schema.tasks.id, taskId), inArray(schema.tasks.status, [...requireStatusIn])))
      .run();
    return r.changes;
  });
}
