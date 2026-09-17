// Persistence behind `image-rebuild.ts`.
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { INBOX_STATUS } from "./inbox-enums.js";
export {
  agentById,
  closeInboxMessage,
  insertInboxMessage,
  lastSessionOfTask,
  taskWithAssignee,
} from "./diagnostics-store.js";

export type InboxRow = typeof schema.inboxMessages.$inferSelect;

/** Rebuild questions still open: one per broken (machine, image), a handful at most. Grouping is
 *  a rule and lives in `image-rebuild.ts`. */
export function openImageRebuildQuestions(): InboxRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        eq(schema.inboxMessages.status, INBOX_STATUS.open),
        isNotNull(schema.inboxMessages.imageRebuild),
      ),
    )
    .all();
}

/** Task names, so the question names what it holds back instead of counting. */
export function taskNames(taskIds: readonly string[]): string[] {
  return taskIds
    .map((id) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()?.name)
    .filter((n): n is string => !!n);
}
