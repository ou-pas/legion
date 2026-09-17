// The project's demo flag and one task's live session (`serializeTask`; the batch path already
// passes its sessions in).
import { eq } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";

export { isDemoProject };

/** Does a live session exist for this task, among those `isLive` would keep? */
export function hasLiveSession(taskId: string, isLive: (status: string) => boolean): boolean {
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .all()
    .some((s) => isLive(s.status));
}
