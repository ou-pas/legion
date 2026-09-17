// Status, archiving, brief and the `queued` flag, in one transaction (see `writeCore`,
// `task-patch.ts`). No business `if` here: "postponing leaves the queue" and "finishing settles the
// chain" are `task-patch.ts` decisions. This module writes `queued` as given and calls `onFinish`
// without judging it, as `purge-store.ts` calls `onBeforeDelete`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export function writeStatusArchivedDescription(
  taskId: string,
  fields: { status?: string; archived?: boolean; queued?: boolean; description?: string },
  onFinish: () => string[],
): string[] {
  const { status, archived, description, queued } = fields;
  if (
    status === undefined &&
    archived === undefined &&
    description === undefined &&
    queued === undefined
  )
    return [];
  return db.transaction(() => {
    db.update(schema.tasks)
      .set({
        ...(status !== undefined
          ? { status: status as typeof schema.tasks.$inferInsert.status }
          : {}),
        ...(queued !== undefined ? { queued } : {}),
        ...(archived !== undefined ? { archived } : {}),
        ...(description !== undefined ? { description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();
    return onFinish();
  });
}
