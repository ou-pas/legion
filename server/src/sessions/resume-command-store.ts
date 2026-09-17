// Queries for the resume command; the rules live in `resume-command.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SessionRow = typeof schema.sessions.$inferSelect;

export function sessionRow(sessionId: string): SessionRow | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
}

/** `null` if the project sets none: falling back to the control plane's image is the caller's
 *  rule. */
export function projectSessionImageOfTask(taskId: string): string | null {
  return (
    db
      .select({ image: schema.projects.sessionImage })
      .from(schema.tasks)
      .innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
      .where(eq(schema.tasks.id, taskId))
      .get()?.image ?? null
  );
}

/** `undefined` if the runner is gone. */
export function runnerLocation(
  runnerId: string,
): { name: string; dockerHost: string | null } | undefined {
  return db
    .select({ name: schema.runners.name, dockerHost: schema.runners.dockerHost })
    .from(schema.runners)
    .where(eq(schema.runners.id, runnerId))
    .get();
}
