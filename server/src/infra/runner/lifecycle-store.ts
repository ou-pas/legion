// A runner's live sessions. `activeStatuses` is a domain notion (`ACTIVE_STATUSES`,
// session-terminal.ts): the store receives it, it does not know it.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";
import type { SessionStatus } from "../../sessions/session-terminal.js";

export function activeSessionsOnRunner(
  runnerId: string,
  activeStatuses: readonly SessionStatus[],
): { id: string; status: string }[] {
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.runnerId, runnerId),
        inArray(schema.sessions.status, [...activeStatuses]),
      ),
    )
    .all()
    .map((s) => ({ id: s.id, status: s.status }));
}
