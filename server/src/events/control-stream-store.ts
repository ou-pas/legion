// Database access for `control-stream.ts`: the task and project of a session, to enrich a bus
// signal.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export interface SessionTaskProject {
  taskId: string | null;
  projectId: string | null;
}

/** One primary-key read per event, no memo: see `control-stream.ts` for why. */
export function taskAndProjectOfSession(sessionId: string): SessionTaskProject | undefined {
  return db
    .select({ taskId: schema.sessions.taskId, projectId: schema.tasks.projectId })
    .from(schema.sessions)
    .leftJoin(schema.tasks, eq(schema.tasks.id, schema.sessions.taskId))
    .where(eq(schema.sessions.id, sessionId))
    .get();
}
