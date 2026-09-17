// Inserting the task and its blockers in one transaction (see `task-create.ts` for why).
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { addBlocker } from "./blockers-store.js";

export function insertTask(
  task: typeof schema.tasks.$inferInsert,
  blockerIds: string[],
): typeof schema.tasks.$inferSelect | undefined {
  return db.transaction((tx) => {
    tx.insert(schema.tasks).values(task).run();
    for (const blockerId of blockerIds) addBlocker(task.id, blockerId, tx);
    return tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
  });
}
