// Queries for the operator-requested pause; the rules live in `operator-pause.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

/** `undefined` if the session is unknown: both cases differ, and `pauseRefusal` turns them into a
 *  404 or a 409. */
export function sessionStatusOf(sessionId: string): string | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()?.status;
}

export function setPauseRequested(sessionId: string, requested: boolean): void {
  db.update(schema.sessions)
    .set({ pauseRequested: requested })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

/** `false` if the session is unknown. */
export function pauseRequestedFlag(sessionId: string): boolean {
  const row = db
    .select({ p: schema.sessions.pauseRequested })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  return Boolean(row?.p);
}

/** Over the whole trace: scoping to the current run is the caller's rule (`run-scope.ts`). */
export function operatorPauseTimes(sessionId: string): number[] {
  return db
    .select({ at: schema.sessionEvents.createdAt })
    .from(schema.sessionEvents)
    .where(
      and(
        eq(schema.sessionEvents.sessionId, sessionId),
        eq(schema.sessionEvents.type, "operator_pause"),
      ),
    )
    .all()
    .map((r) => r.at.getTime());
}
