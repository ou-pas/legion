// Concierge routes: ask, situation report, conversation list, and reading one conversation.
//
// `POST /api/concierge` takes `{ message, conversationId? }` and returns
// `{ conversationId, reply }` (slice nav/10). The client carries the conversation id, the server
// reads back what was said. Without an id a new conversation starts and its id is returned.
import { Hono } from "hono";
import { isConversationId, validateConciergeInput } from "./concierge-input.js";
import { fetchConciergeContext } from "./concierge-context.js";
import { conciergeBrief } from "./concierge-brief.js";
import {
  appendTurn,
  conversationExists,
  latestConversationId,
  newConversationId,
} from "./concierge-store.js";
import { listConversations, readConversation, readHistory } from "./concierge-conversations.js";
import { askConcierge } from "./concierge.js";

/** `ask` is injectable so `routes.test.ts` exercises the wiring without the SDK: read the history
 *  from the database, write both turns, write nothing when no answer came. `index.ts` passes none
 *  and gets the real one. */
export function registerConciergeRoutes(app: Hono, deps: { ask?: typeof askConcierge } = {}): void {
  const ask = deps.ask ?? askConcierge;

  // No zod schema on purpose: `validateConciergeInput` already is one, with its own tests. A
  // schema on top would be two definitions of the same contract.
  app.post("/api/concierge", async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateConciergeInput(body);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    const { message, conversationId } = validated.ask;

    // An unknown id is a 404, not an empty conversation: a mistyped URL must not create one.
    if (conversationId !== null && !conversationExists(conversationId))
      return c.json({ error: "conversation not found" }, 404);
    const id = conversationId ?? newConversationId();

    // The history comes from the database, never from the request body.
    const history = conversationId === null ? [] : readHistory(conversationId);
    const result = await ask({ message, history }, fetchConciergeContext());
    if (!result.ok) return c.json({ error: result.error }, result.status);

    // Both turns are written after the answer, and only if it came: an unanswered question must
    // not stay in the thread. The 1 ms offset fixes their read-back order.
    const at = Date.now();
    appendTurn(id, "user", message, new Date(at));
    appendTurn(id, "assistant", result.reply, new Date(at + 1));
    return c.json({ conversationId: id, reply: result.reply });
  });

  // `GET`: a cached read. `?refresh=1` recomputes, the only gesture that spends a model call
  // (never a timer, see concierge-brief.ts).
  app.get("/api/concierge/brief", async (c) =>
    c.json(await conciergeBrief({ refresh: c.req.query("refresh") === "1" })),
  );

  // `latest` is returned rather than inferred from the first item, so the page does not restate a
  // server rule; `null` on first launch is an answer in itself.
  app.get("/api/concierge/conversations", (c) =>
    c.json({ conversations: listConversations(), latest: latestConversationId() }),
  );

  app.get("/api/concierge/conversations/:id", (c) => {
    const id = c.req.param("id");
    if (!isConversationId(id) || !conversationExists(id))
      return c.json({ error: "conversation not found" }, 404);
    return c.json({ id, turns: readConversation(id) });
  });
}
