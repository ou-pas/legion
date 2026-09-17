// Concierge history and conversations (slice nav/10): the context budget replayed to the model,
// the human read-back, and the conversation list.
//
// Real database in a temporary file: the point is that a write survives, which an in-memory fake
// would not prove.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-concierge-conversations-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { HISTORY_LENGTH_MAX, HISTORY_TURN_MAX } = await import("./concierge-input.js");
const { appendTurn } = await import("./concierge-store.js");
const { listConversations, readConversation, readHistory } =
  await import("./concierge-conversations.js");
const { CHAT_ROLE } = await import("./chat-enums.js");

const T0 = new Date("2026-08-30T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const C1 = "conv-one",
  C2 = "conv-two",
  LONG = "conv-long";

before(() => {
  appendTurn(C1, "user", "what ran last night?", at(0));
  appendTurn(C1, "assistant", "three sessions, all on Legion", at(1));
  appendTurn(C1, "user", "and the cost?", at(2));
  appendTurn(C1, "assistant", "$18.40 over seven days", at(3));

  // More recent than C1: the one to resume on arrival.
  appendTurn(C2, "user", "why is slice 09 not moving?", at(10_000));
  appendTurn(C2, "assistant", "its session is stopped on a gate", at(10_001));

  // Longer than the read-back bound, with an oversized turn at the end.
  for (let i = 0; i < HISTORY_LENGTH_MAX + 6; i += 1) {
    appendTurn(LONG, i % 2 === 0 ? "user" : "assistant", `turn ${i}`, at(20_000 + i));
  }
  appendTurn(LONG, "assistant", "x".repeat(HISTORY_TURN_MAX + 500), at(30_000));
});

describe("readConversation, what the page shows on reload", () => {
  it("returns whole turns in the order they were said", () => {
    assert.deepEqual(readConversation(C1), [
      { role: CHAT_ROLE.user, content: "what ran last night?" },
      { role: CHAT_ROLE.assistant, content: "three sessions, all on Legion" },
      { role: CHAT_ROLE.user, content: "and the cost?" },
      { role: CHAT_ROLE.assistant, content: "$18.40 over seven days" },
    ]);
  });

  it("returns an empty list for an unknown conversation, never throws", () => {
    assert.deepEqual(readConversation("never-seen"), []);
  });
});

describe("readHistory, what is replayed to the model, bounded", () => {
  it("returns turns in order", () => {
    const h = readHistory(C1);
    assert.equal(h[0]?.content, "what ran last night?");
    assert.equal(h.at(-1)?.content, "$18.40 over seven days");
  });

  it("never replays more than HISTORY_LENGTH_MAX turns, and keeps the last ones", () => {
    const h = readHistory(LONG);
    assert.equal(h.length, HISTORY_LENGTH_MAX);
    // The last one written is the oversized turn: the end of the conversation survives.
    assert.ok(h.at(-1)!.content.startsWith("x"));
  });

  it("truncates an oversized turn and says so", () => {
    const long = readHistory(LONG).at(-1)!;
    assert.equal(long.content.length, HISTORY_TURN_MAX + 1);
    assert.ok(long.content.endsWith("…"));
  });

  it("never mixes two conversations", () => {
    assert.ok(readHistory(C2).every((t) => !t.content.includes("last night")));
  });
});

describe("listConversations, the rail's Conversations section", () => {
  it("most recently fed first", () => {
    const ids = listConversations().map((c) => c.id);
    assert.equal(ids[0], LONG);
    assert.ok(ids.indexOf(C2) < ids.indexOf(C1));
  });

  it("titles with the operator's first turn, not just the first turn", () => {
    const c1 = listConversations().find((c) => c.id === C1)!;
    assert.equal(c1.title, "what ran last night?");
  });

  it("counts turns and dates the last one", () => {
    const c1 = listConversations().find((c) => c.id === C1)!;
    assert.equal(c1.turnCount, 4);
    assert.equal(c1.startedAt, at(0).getTime());
    assert.equal(c1.updatedAt, at(3).getTime());
  });
});
