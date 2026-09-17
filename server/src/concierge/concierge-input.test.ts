// The client no longer sends the history (slice nav/10, AC#1): the body carries the conversation
// id and the server reads back what was said. The history bounds moved server-side and are
// tested in `concierge-conversations.test.ts`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConversationId, MESSAGE_MAX, validateConciergeInput } from "./concierge-input.js";
import { CHAT_ROLE } from "./chat-enums.js";

describe("validateConciergeInput", () => {
  it("accepts a message alone: without an id, a new conversation starts", () => {
    const r = validateConciergeInput({ message: "what's new?" });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.ask, { message: "what's new?", conversationId: null });
  });

  it("trims the message", () => {
    const r = validateConciergeInput({ message: "  hello  " });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ask.message, "hello");
  });

  it("accepts a conversation id and returns it as-is", () => {
    const r = validateConciergeInput({ message: "and then?", conversationId: "aB3-x_9Zqw" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ask.conversationId, "aB3-x_9Zqw");
  });

  it("treats an explicit `null` as no id", () => {
    const r = validateConciergeInput({ message: "m", conversationId: null });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ask.conversationId, null);
  });

  it("refuses a body that is not an object", () => {
    assert.equal(validateConciergeInput(null).ok, false);
    assert.equal(validateConciergeInput("text").ok, false);
    assert.equal(validateConciergeInput(42).ok, false);
  });

  it("refuses a missing, empty or blank message", () => {
    assert.equal(validateConciergeInput({}).ok, false);
    assert.equal(validateConciergeInput({ message: "" }).ok, false);
    assert.equal(validateConciergeInput({ message: "   " }).ok, false);
    assert.equal(validateConciergeInput({ message: 42 }).ok, false);
  });

  it("refuses a message that is too long", () => {
    const r = validateConciergeInput({ message: "a".repeat(MESSAGE_MAX + 1) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /too long/);
  });

  it("refuses an id not shaped like ours, since it goes into a WHERE", () => {
    for (const bad of ["", "../etc", "a b", "x'; DROP TABLE", "a".repeat(33), 42, {}]) {
      assert.equal(
        validateConciergeInput({ message: "m", conversationId: bad }).ok,
        false,
        JSON.stringify(bad),
      );
    }
  });

  it("ignores a `history` field, which can no longer dictate anything", () => {
    const r = validateConciergeInput({
      message: "m",
      history: [{ role: CHAT_ROLE.user, content: "liar" }],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(Object.keys(r.ask).sort(), ["conversationId", "message"]);
  });
});

describe("isConversationId", () => {
  it("recognises a nanoid(10) shape and refuses the rest", () => {
    assert.equal(isConversationId("aB3-x_9Zqw"), true);
    assert.equal(isConversationId("a/b"), false);
    assert.equal(isConversationId(undefined), false);
  });
});
