// Validation of `POST /api/concierge`. Pure, testable without a route or the SDK.
//
// The client sends `{ message, conversationId? }` (v49); without an id a new conversation starts.
// It used to send the history itself, which did not survive a reload and let the client rewrite
// what had been said.
//
// `HISTORY_TURN_MAX` and `HISTORY_LENGTH_MAX` now bound what the server reads back before
// replaying it in the prompt (`readHistory`), so a long conversation cannot grow the prompt
// without end.
// `MESSAGE_MAX` is 20 000 since 08/09: at 4 000, pasting an error trace or a log excerpt, the most
// common concierge question, was refused.
export const MESSAGE_MAX = 20_000;
export const HISTORY_TURN_MAX = 4_000;
export const HISTORY_LENGTH_MAX = 40;

/** A conversation id is ours (`nanoid(10)`) and comes back through the URL or the body. Anything
 *  of another shape is refused before it reaches a `WHERE`. */
const ID = /^[A-Za-z0-9_-]{1,32}$/;

export interface ConciergeAsk {
  message: string;
  /** `null` starts a conversation. Never `undefined`: the caller must choose. */
  conversationId: string | null;
}

export type ConciergeInputResult = { ok: true; ask: ConciergeAsk } | { ok: false; error: string };

export function isConversationId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}

export function validateConciergeInput(body: unknown): ConciergeInputResult {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid request" };
  const o = body as Record<string, unknown>;

  if (typeof o.message !== "string" || !o.message.trim())
    return { ok: false, error: "message required" };
  const message = o.message.trim();
  if (message.length > MESSAGE_MAX)
    return { ok: false, error: `message too long (max ${MESSAGE_MAX} characters)` };

  const raw = o.conversationId;
  if (raw === undefined || raw === null)
    return { ok: true, ask: { message, conversationId: null } };
  if (!isConversationId(raw)) return { ok: false, error: "invalid conversationId" };

  return { ok: true, ask: { message, conversationId: raw } };
}
