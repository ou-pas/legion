// What this file protects:
//
//  1. Closing. Switching the SDK prompt from a string to a stream trades "it stops on its own" for
//     "it stops when I say so". A stream nobody closes is a container running forever on work
//     already reported. The risk this feature introduces, hence the heart of these tests.
//  2. The last-millisecond message. An injection arriving during the last turn must not vanish
//     because closing overtook it: the iterator DRAINS its queue before ending.
//  3. The admission. Pushing into a closed stream returns `false`, so the runner can SAY so in the
//     trace. An injected message silently evaporating would be exactly the defect being removed.
//
// The module is .mts compiled into the session image, imported as is: THE CODE THAT RUNS is what is
// tested.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInputStream, userMessage } from "../../../runner-payload/steer-stream.mjs";
import type { UserMessage } from "../../../runner-payload/steer-stream.mjs";

// Both types come from the module since lot 10. The message and stream shapes used to be copied
// here with `make` gluing them through an `as Stream`, the only option while the payload was untyped
// JS. A copy the compiler does not reread guards nothing: a field renamed in the module left it
// green.
type SdkUser = UserMessage;
type Stream = ReturnType<typeof createInputStream>;

const make = (first?: string): Stream => createInputStream(first);
const texts = (msgs: SdkUser[]) => msgs.map((m) => m.message.content);
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Consumes everything until the stream closes. */
async function drain(s: Stream): Promise<SdkUser[]> {
  const out: SdkUser[] = [];
  for await (const m of s) out.push(m);
  return out;
}

describe("userMessage", () => {
  it("has the shape of an SDK user turn", () => {
    const m = userMessage("hello");
    assert.equal(m.type, "user");
    assert.equal(m.message.role, "user");
    assert.equal(m.message.content, "hello");
    assert.equal(m.parent_tool_use_id, null);
  });

  it("is ATTRIBUTED to a human: a missing origin would be treated as anonymous by the SDK", () => {
    assert.deepEqual(userMessage("hello").origin, { kind: "human" });
  });
});

describe("createInputStream", () => {
  it("the first message is the initial prompt, same content as before streaming", async () => {
    const s = make("# Task: do the thing");
    s.close();
    assert.deepEqual(texts(await drain(s)), ["# Task: do the thing"]);
  });

  it("without an initial prompt, the stream starts empty", async () => {
    const s = make();
    s.close();
    assert.deepEqual(await drain(s), []);
  });

  it("what is pushed during consumption arrives as one more user turn", async () => {
    const s = make("brief");
    const seen: SdkUser[] = [];
    const consumer = (async () => {
      for await (const m of s) seen.push(m);
    })();
    await tick();
    assert.deepEqual(texts(seen), ["brief"]);
    s.push("change course");
    await tick();
    assert.deepEqual(texts(seen), ["brief", "change course"]);
    s.close();
    await consumer;
  });

  it("while the stream is open, consumption does NOT end: the stream's trap", async () => {
    const s = make("brief");
    let finished = false;
    const consumer = drain(s).then(() => {
      finished = true;
    });
    await tick(40);
    assert.equal(finished, false, "an open stream must keep the session waiting for a message");
    s.close();
    await consumer;
    assert.equal(finished, true);
  });

  it("close() drains the queue BEFORE ending: the last-millisecond message is not dropped", async () => {
    const s = make("brief");
    s.push("last word");
    s.close();
    assert.deepEqual(texts(await drain(s)), ["brief", "last word"]);
  });

  it("close() during a wait ends consumption", async () => {
    const s = make("brief");
    const consumer = drain(s);
    await tick();
    s.close();
    assert.deepEqual(texts(await consumer), ["brief"]);
  });

  it("pushing into a closed stream returns false, so the runner can admit it in the trace", () => {
    const s = make("brief");
    assert.equal(s.push("ok"), true);
    s.close();
    assert.equal(s.push("too late"), false);
    assert.equal(s.isClosed, true);
  });

  it("close() is idempotent", async () => {
    const s = make("brief");
    s.close();
    s.close();
    assert.deepEqual(texts(await drain(s)), ["brief"]);
  });

  it("`pending` counts what has not left yet", () => {
    const s = make("brief");
    assert.equal(s.pending, 1);
    s.push("one");
    s.push("two");
    assert.equal(s.pending, 3);
  });

  it("push order is delivery order", async () => {
    const s = make();
    for (const t of ["one", "two", "three"]) s.push(t);
    s.close();
    assert.deepEqual(texts(await drain(s)), ["one", "two", "three"]);
  });
});
