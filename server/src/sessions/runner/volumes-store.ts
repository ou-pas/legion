// Queries for session volumes; the rules live in `volumes.ts`.
//
// Both reads are synchronous and must stay so: `releaseSessionVolumes` runs them before its first
// `await`, because its caller just marked the sessions terminal and the purge tick follows
// closely. Moving them behind an `await` would silently drop the volumes from the purge.
import { inArray } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export function runnerIdsOfSessions(
  sessionIds: readonly string[],
): { id: string; runnerId: string }[] {
  return db
    .select({ id: schema.sessions.id, runnerId: schema.sessions.runnerId })
    .from(schema.sessions)
    .where(inArray(schema.sessions.id, [...sessionIds]))
    .all();
}

/** `null` = this machine's daemon. */
export function dockerHostByRunnerId(): Map<string, string | null> {
  return new Map(
    db
      .select({ id: schema.runners.id, dockerHost: schema.runners.dockerHost })
      .from(schema.runners)
      .all()
      .map((r) => [r.id, r.dockerHost]),
  );
}
