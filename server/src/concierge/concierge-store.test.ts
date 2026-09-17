// Concierge memory (slice nav/10, AC#1): turns persist server-side and a conversation can be
// resumed. Bounded history and the conversation list are tested in
// `concierge-conversations.test.ts`.
//
// Real database in a temporary file: the point is that a write survives, which an in-memory fake
// would not prove.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-concierge-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { appendTurn, conversationExists, latestConversationId, newConversationId } =
  await import("./concierge-store.js");

const T0 = new Date("2026-08-30T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const C1 = "conv-one",
  LONG = "conv-long";

before(() => {
  appendTurn(C1, "user", "what ran last night?", at(0));
  appendTurn(C1, "assistant", "three sessions, all on Legion", at(1));
  appendTurn(LONG, "user", "turn 0", at(20_000));
  appendTurn(LONG, "assistant", "turn 1", at(30_000));
});

describe("resuming a conversation", () => {
  it("latestConversationId returns the one just left", () => {
    assert.equal(latestConversationId(), LONG);
  });

  it("conversationExists tells a conversation from a made-up id", () => {
    assert.equal(conversationExists(C1), true);
    assert.equal(conversationExists("never-seen"), false);
  });

  it("a new id designates nothing until something is written to it", () => {
    const id = newConversationId();
    assert.equal(conversationExists(id), false);
    appendTurn(id, "user", "first word", at(90_000));
    assert.equal(conversationExists(id), true);
    assert.equal(latestConversationId(), id);
  });
});
