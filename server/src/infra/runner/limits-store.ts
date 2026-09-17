// A runner's load, counted from sessions. The statuses that count (`OCCUPYING_STATUSES`) belong to
// the rule; the store receives them.
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";
import type { SessionStatus } from "../../sessions/session-terminal.js";

/** Active sessions per runner, in one grouped query. */
export function sessionCountsByRunner(
  occupyingStatuses: readonly SessionStatus[],
): Map<string, number> {
  const rows = db
    .select({ runnerId: schema.sessions.runnerId, n: sql<number>`count(*)` })
    .from(schema.sessions)
    .where(inArray(schema.sessions.status, [...occupyingStatuses]))
    .groupBy(schema.sessions.runnerId)
    .all();
  return new Map(rows.map((r) => [r.runnerId, Number(r.n)]));
}
