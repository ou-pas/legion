// The concierge's memory: the only code that writes `concierge_turns` (v49), and the raw queries
// `concierge-conversations.ts` builds on. Truncation, titles and the
// `ConciergeConversation` aggregate are decided there.
//
// The server, not the browser, is the source of what was said.
//
// A conversation has no table: it is the set of turns carrying its id.
import { asc, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../shared/db.js";

export type TurnRow = typeof schema.conciergeTurns.$inferSelect;

/** A new conversation id. Ten characters like elsewhere: an object id, not a secret. */
export function newConversationId(): string {
  return nanoid(10);
}

/** Appends a turn. `createdAt` is injectable so tests need not sleep between writes. */
export function appendTurn(
  conversationId: string,
  role: TurnRow["role"],
  content: string,
  createdAt = new Date(),
): void {
  db.insert(schema.conciergeTurns)
    .values({ id: nanoid(12), conversationId, role, content, createdAt })
    .run();
}

/** The `limit` most recent turns of a conversation, newest first; `readHistory` reorders and
 *  truncates them.
 *
 *  `rowid`, not `id`, breaks millisecond ties (03/09): `id` is a random `nanoid`, so two turns in
 *  the same millisecond came back in random order, and here the order is the context sent to the
 *  model. Same defect and fix as `inbox/inbox-history.ts`, found through a flaky test. */
export function recentTurnRows(conversationId: string, limit: number): TurnRow[] {
  return db
    .select()
    .from(schema.conciergeTurns)
    .where(eq(schema.conciergeTurns.conversationId, conversationId))
    .orderBy(desc(schema.conciergeTurns.createdAt), desc(sql`rowid`))
    .limit(limit)
    .all();
}

/** Every turn of a conversation, untruncated, in the order they were said. */
export function turnRowsInOrder(conversationId: string): TurnRow[] {
  return db
    .select()
    .from(schema.conciergeTurns)
    .where(eq(schema.conciergeTurns.conversationId, conversationId))
    .orderBy(asc(schema.conciergeTurns.createdAt), asc(sql`rowid`))
    .all();
}

/** Every turn of every conversation, in order, so `listConversations` rebuilds them in one scan.
 *
 *  ponytail: full scan rather than GROUP BY; one operator makes hundreds of turns, not millions.
 *  Move to GROUP BY if the table passes a few thousand rows. */
export function allTurnRowsInOrder(): TurnRow[] {
  return db
    .select()
    .from(schema.conciergeTurns)
    .orderBy(asc(schema.conciergeTurns.createdAt), asc(sql`rowid`))
    .all();
}

/** The most recently fed conversation, or `null` on first launch. */
export function latestConversationId(): string | null {
  const row = db
    .select({ id: schema.conciergeTurns.conversationId })
    .from(schema.conciergeTurns)
    .orderBy(desc(schema.conciergeTurns.createdAt), desc(sql`rowid`))
    .limit(1)
    .get();
  return row?.id ?? null;
}

/** A made-up id in the URL must get a 404, not an empty conversation one could continue by
 *  accident. */
export function conversationExists(conversationId: string): boolean {
  return (
    db
      .select({ id: schema.conciergeTurns.id })
      .from(schema.conciergeTurns)
      .where(eq(schema.conciergeTurns.conversationId, conversationId))
      .limit(1)
      .get() !== undefined
  );
}
