// Acknowledging an agent's speech (v36).
//
// The defect closed: `report()` was a POST without a number or an ack. A report that did not go
// through was a lost sentence, and nothing on either side knew one was missing. On 26/08 two
// sessions died on "container gone with no result reported": they had spoken, nothing crossed, and
// the UI concluded failure without being able to say anything else.
//
// This file locks the three properties that make re-sending possible, above all the third: a
// duplicate must redo NOTHING. A runtime re-sending out of caution must not re-notify a failed push
// or inflate the event counter, otherwise the remedy would cost more than the failure.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-seq-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { ackOf, publish, publishSeq, replay, subscribe } = await import("../shared/events.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p-seq",
  A = "a-seq",
  T = "t-seq",
  R = "r-seq";
const S = "s-seq",
  OTHER = "s-other";
const now = new Date();

function reset(): void {
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({
      id: T,
      projectId: P,
      name: "t",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: R, name: "local", kind: RUNNER_KIND.process }).run();
  for (const id of [S, OTHER])
    db.insert(schema.sessions)
      .values({
        id,
        taskId: T,
        agentId: A,
        runnerId: R,
        status: "running",
        model: "sonnet",
        callbackToken: `tok-${id}`,
        startedAt: now,
      })
      .run();
}

const eventCount = (id: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!.eventCount;

describe("the ack: how far the server heard", () => {
  beforeEach(reset);

  it("a silent session acknowledged nothing", () => {
    assert.equal(ackOf(S), 0);
  });

  it("the ack follows the highest number received, not the row count", () => {
    publishSeq(S, 1, "text", { text: "a" });
    publishSeq(S, 2, "text", { text: "b" });
    assert.equal(ackOf(S), 2);
  });

  it("it is PER session: two sessions do not share their count", () => {
    // The defect avoided: `session_events.id` is global. Using it as an ack would give one session
    // another's number, and the runtime would re-send into the void.
    publishSeq(S, 1, "text", { text: "a" });
    publishSeq(OTHER, 1, "text", { text: "a" });
    publishSeq(OTHER, 2, "text", { text: "b" });
    assert.equal(ackOf(S), 1);
    assert.equal(ackOf(OTHER), 2);
  });
});

describe("re-sending is free, and above all WITHOUT EFFECT", () => {
  beforeEach(reset);

  it("the same number twice writes a single row", () => {
    assert.equal(publishSeq(S, 1, "text", { text: "a" }), true);
    assert.equal(publishSeq(S, 1, "text", { text: "a" }), false);
    assert.equal(replay(S).length, 1);
  });

  it("a duplicate does not inflate the session's event counter", () => {
    publishSeq(S, 1, "text", { text: "a" });
    const before = eventCount(S);
    publishSeq(S, 1, "text", { text: "a" });
    assert.equal(eventCount(S), before);
  });

  it("a duplicate is not broadcast to SSE subscribers", () => {
    // The property protecting the caller's side effects: the route only notifies a failed push if
    // publishing returned `true`.
    const seen: string[] = [];
    const off = subscribe(S, (ev) => seen.push(ev.type));
    publishSeq(S, 1, "repo_push_failed", { repo: "x" });
    publishSeq(S, 1, "repo_push_failed", { repo: "x" });
    off();
    assert.deepEqual(seen, ["repo_push_failed"]);
  });

  it("re-sending an already acknowledged frame does not break what follows", () => {
    // The real case: the runtime sent 1, 2, 3; the ack of 3 was lost; it replays 2 and 3.
    publishSeq(S, 1, "text", { text: "a" });
    publishSeq(S, 2, "text", { text: "b" });
    publishSeq(S, 3, "text", { text: "c" });
    assert.equal(publishSeq(S, 2, "text", { text: "b" }), false);
    assert.equal(publishSeq(S, 3, "text", { text: "c" }), false);
    assert.equal(publishSeq(S, 4, "text", { text: "d" }), true);
    assert.deepEqual(
      replay(S).map((e) => (e.payload as { text: string }).text),
      ["a", "b", "c", "d"],
    );
    assert.equal(ackOf(S), 4);
  });
});

// A session spans several containers, and the number is unique per SESSION: the pair that cost a
// whole run on 08/09. Each pause destroys the container, each resume creates a new one under the
// same session id, and its in-memory counter restarted at zero. The server then refused every
// number as a duplicate (correctly), but from the container the refusal looks like an ack: the
// queue drained against it and the resume's log vanished without a line.
//
// The fix is `spec.seqBase = ackOf(sessionId)`. These tests lock the property it relies on: resuming
// the count from the ack yields FREE numbers.
describe("a resumed session continues its log instead of losing it", () => {
  beforeEach(reset);

  it("counting from the ack yields numbers the server accepts", () => {
    for (const seq of [1, 2, 3]) publishSeq(S, seq, "text", { text: `run1-${seq}` });
    // What `buildSpec` puts in the resumed container's spec.
    const seqBase = ackOf(S);
    assert.equal(seqBase, 3);
    assert.equal(publishSeq(S, seqBase + 1, "text", { text: "run2-a" }), true);
    assert.equal(publishSeq(S, seqBase + 2, "text", { text: "run2-b" }), true);
    assert.deepEqual(
      replay(S).map((e) => (e.payload as { text: string }).text),
      ["run1-1", "run1-2", "run1-3", "run2-a", "run2-b"],
      "both runs form ONE log, in order",
    );
  });

  it("restarting from zero, as before, got the whole resume refused", () => {
    // The test describing the FAILURE, kept on purpose: without it the fix above reads as a style
    // preference. A resumed container renumbering from 1 writes nothing.
    for (const seq of [1, 2, 3]) publishSeq(S, seq, "text", { text: `run1-${seq}` });
    for (const seq of [1, 2, 3])
      assert.equal(
        publishSeq(S, seq, "text", { text: `run2-${seq}` }),
        false,
        `number ${seq} refused`,
      );
    assert.equal(replay(S).length, 3, "and the resume's speech is lost");
  });
});

describe("what the number does NOT change", () => {
  beforeEach(reset);

  it("a control plane event has no number, and blocks none", () => {
    // `publish` stays the path for events the SERVER emits (fs_denied, dependency_wait, a warning).
    // They do not come from the runtime, so they are not re-sent and have nothing to number. The unique
    // index allows any number of NULLs, which is exactly why it is nullable.
    publish(S, "fs_denied", { path: "/x" });
    publish(S, "fs_denied", { path: "/y" });
    publishSeq(S, 1, "text", { text: "a" });
    assert.equal(replay(S).length, 3);
    assert.equal(ackOf(S), 1);
  });

  it("the SSE cursor stays the GLOBAL id, in arrival order", () => {
    // `replay(afterDbId)` keeps its contract: the browser still sends back `Last-Event-ID`. Both
    // numbers coexist: one orders for the UI, the other acknowledges for the runtime.
    publishSeq(S, 1, "text", { text: "a" });
    publish(S, "fs_op", { op: "write" });
    publishSeq(S, 2, "text", { text: "b" });
    const all = replay(S);
    assert.deepEqual(
      all.map((e) => e.type),
      ["text", "fs_op", "text"],
    );
    assert.deepEqual(
      replay(S, all[0]!.dbId).map((e) => e.type),
      ["fs_op", "text"],
    );
  });
});
