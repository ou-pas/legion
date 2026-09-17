// Persistence behind `session-close.ts`.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { TERMINAL_STATUSES } from "../sessions/session-terminal.js";
import { INBOX_STATUS } from "./inbox-enums.js";

export function openInboxIdsOfDeadSessions(): string[] {
  return db
    .select({ id: schema.inboxMessages.id })
    .from(schema.inboxMessages)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.inboxMessages.sessionId))
    .where(
      and(
        eq(schema.inboxMessages.status, INBOX_STATUS.open),
        inArray(schema.sessions.status, [...TERMINAL_STATUSES]),
      ),
    )
    .all()
    .map((m) => m.id);
}

export function closeInboxMessage(id: string): void {
  db.update(schema.inboxMessages)
    .set({ status: INBOX_STATUS.closed })
    .where(eq(schema.inboxMessages.id, id))
    .run();
}

export function closeOpenInboxOfSession(sessionId: string): void {
  db.update(schema.inboxMessages)
    .set({ status: INBOX_STATUS.closed })
    .where(
      and(
        eq(schema.inboxMessages.sessionId, sessionId),
        eq(schema.inboxMessages.status, INBOX_STATUS.open),
      ),
    )
    .run();
}
