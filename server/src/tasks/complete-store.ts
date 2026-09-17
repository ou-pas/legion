import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export function findTaskRow(taskId: string): typeof schema.tasks.$inferSelect | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

/** The transition and the blocker release it produces fall in the same transaction (see
 *  `complete.ts`): the module's only call touching `db.transaction`. */
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn);
}
