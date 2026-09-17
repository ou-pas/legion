import { inArray } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";
export { runnerRow } from "./manager-store.js";

/** So the notice can name the tasks a wait holds. Ids that disappeared (deleted task) drop out
 *  on their own: there is nothing to say about a task that no longer exists. */
export function taskNamesOf(taskIds: readonly string[]): string[] {
  if (taskIds.length === 0) return [];
  return db
    .select({ name: schema.tasks.name })
    .from(schema.tasks)
    .where(inArray(schema.tasks.id, [...taskIds]))
    .all()
    .map((r) => r.name);
}
