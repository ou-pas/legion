import { eq } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";

export { isDemoProject };

export function findTaskRow(taskId: string): typeof schema.tasks.$inferSelect | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function runnerExists(runnerId: string): boolean {
  return Boolean(db.select().from(schema.runners).where(eq(schema.runners.id, runnerId)).get());
}

/** Sets (or clears) the chosen runner and re-reads the row; `undefined` if the task vanished between
 *  read and write. */
export function setChosenRunner(
  taskId: string,
  chosenRunnerId: string | null,
): typeof schema.tasks.$inferSelect | undefined {
  db.update(schema.tasks)
    .set({ chosenRunnerId, updatedAt: new Date() })
    .where(eq(schema.tasks.id, taskId))
    .run();
  return findTaskRow(taskId);
}
