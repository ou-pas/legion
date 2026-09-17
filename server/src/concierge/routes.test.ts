// The wiring of `POST /api/concierge` (slice nav/10, AC#1): turns persist server-side, a
// conversation resumes, and the client no longer sends the history.
//
// The store and input tests do not say where the history replayed to the model comes from. This
// file catches a route that accepts the new body and still replays what it is given.
//
// The SDK is never reached: `ask` is injected and captures its input.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";
import type { ConciergeInput, ConciergeResult } from "./concierge.js";

const dir = mkdtempSync(join(tmpdir(), "legion-concierge-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerConciergeRoutes } = await import("./routes.js");
const { CHAT_ROLE } = await import("./chat-enums.js");

/** What the server passed to the model on the last call. */
let seen: ConciergeInput | null = null;
let answer: ConciergeResult = { ok: true, reply: "nothing new" };

const app = new Hono();
registerConciergeRoutes(app, {
  ask: async (input) => {
    seen = input;
    return answer;
  },
});

const ask = (body: unknown) =>
  app.request("/api/concierge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db.delete(schema.conciergeTurns).run();
  seen = null;
  answer = { ok: true, reply: "nothing new" };
});

describe("POST /api/concierge, the conversation lives server-side", () => {
  it("without an id, starts a new conversation and returns its id", async () => {
    const res = await ask({ message: "what's new?" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { conversationId: string; reply: string };
    assert.equal(body.reply, "nothing new");
    assert.match(body.conversationId, /^[A-Za-z0-9_-]{10}$/);
    // First turn: no history to replay, and certainly not an invented one.
    assert.deepEqual(seen, { message: "what's new?", history: [] });
  });

  it("writes both turns in order, and reads them back", async () => {
    const { conversationId } = (await (await ask({ message: "what's new?" })).json()) as {
      conversationId: string;
    };
    const read = await app.request(`/api/concierge/conversations/${conversationId}`);
    assert.equal(read.status, 200);
    assert.deepEqual(((await read.json()) as { turns: unknown }).turns, [
      { role: CHAT_ROLE.user, content: "what's new?" },
      { role: CHAT_ROLE.assistant, content: "nothing new" },
    ]);
  });

  it("resumes a conversation: the second call replays what the database holds", async () => {
    const { conversationId } = (await (await ask({ message: "what's new?" })).json()) as {
      conversationId: string;
    };
    answer = { ok: true, reply: "$18.40 over seven days" };
    await ask({ message: "and the cost?", conversationId });
    assert.deepEqual(seen, {
      message: "and the cost?",
      history: [
        { role: CHAT_ROLE.user, content: "what's new?" },
        { role: CHAT_ROLE.assistant, content: "nothing new" },
      ],
    });
  });

  it("never lets a client-sent `history` reach the model", async () => {
    const { conversationId } = (await (await ask({ message: "first" })).json()) as {
      conversationId: string;
    };
    await ask({
      message: "second",
      conversationId,
      history: [{ role: CHAT_ROLE.user, content: "I never said that" }],
    });
    const replayed = (seen as unknown as ConciergeInput).history.map((h) => h.content);
    assert.ok(
      !replayed.includes("I never said that"),
      "the client no longer decides what was said",
    );
    assert.deepEqual(replayed, ["first", "nothing new"]);
  });

  it("writes nothing when no answer came", async () => {
    answer = { ok: false, status: 504, error: "timed out" };
    const res = await ask({ message: "what's new?" });
    assert.equal(res.status, 504);
    assert.equal(db.select().from(schema.conciergeTurns).all().length, 0);
  });

  it("returns 404 for an unknown id, never a silently created conversation", async () => {
    const res = await ask({ message: "m", conversationId: "neverseen1" });
    assert.equal(res.status, 404);
    assert.equal(seen, null, "no model call may go out for an unknown conversation");
    assert.equal(db.select().from(schema.conciergeTurns).all().length, 0);
  });
});

describe("GET /api/concierge/conversations, what the rail lists", () => {
  it("returns the conversations and the one to resume on arrival", async () => {
    const first = (await (await ask({ message: "one" })).json()) as { conversationId: string };
    const second = (await (await ask({ message: "two" })).json()) as { conversationId: string };
    const body = (await (await app.request("/api/concierge/conversations")).json()) as {
      conversations: { id: string; title: string }[];
      latest: string | null;
    };
    assert.equal(body.latest, second.conversationId);
    assert.deepEqual(
      body.conversations.map((c) => c.title),
      ["two", "one"],
    );
    assert.ok(body.conversations.some((c) => c.id === first.conversationId));
  });

  it("returns an empty list and a null `latest` on an empty database", async () => {
    const body = await (await app.request("/api/concierge/conversations")).json();
    assert.deepEqual(body, { conversations: [], latest: null });
  });
});
