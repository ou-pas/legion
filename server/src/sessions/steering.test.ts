// What this file protects:
//
//  1. The boundary. A session only listens in `running`; any other state is a NAMED refusal, never
//     a silently swallowed message. The two cases from the request (finished session, `waiting`
//     session) are tested explicitly, plus the missing session (404, not 409: we do not pretend to
//     know what we do not).
//  2. The queue. An injected message leaves ONCE (two runtimes pulling at the same time cannot
//     duplicate it), in writing order, and what never left stays marked undelivered: that
//     distinguishes "the agent got it" from "it died in the queue", the whole value of
//     `deliveredAt`.
//  3. The trace. `steer` on send, `steer_delivered` on delivery: an invisible user turn would be
//     exactly the defect this feature exists to remove.
//
// Real temporary SQLite, like lifecycle.test.ts / task-edit.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "./session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-steering-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { replay } = await import("../shared/events.js");
const { deleteTask } = await import("../projects/purge.js");
const {
  STEER_MAX_LEN,
  enqueueSteer,
  normalizeSteerText,
  pendingSteerCount,
  steerRefusal,
  takePendingSteers,
  waitForSteers,
} = await import("./steering.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p1";
const A = "a1";
const R = "r1";
const T = "t1";

function makeSession(id: string, status: SessionStatus) {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: T,
      agentId: A,
      runnerId: R,
      model: "sonnet",
      status,
      callbackToken: "tok",
      startedAt: new Date(),
    })
    .run();
  return id;
}

function reset() {
  const now = new Date();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: R, name: "r", kind: RUNNER_KIND.process }).run();
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
}

describe("steerRefusal: who listens, and who refuses saying so", () => {
  it("a `running` session accepts", () => {
    assert.equal(steerRefusal("running"), null);
  });

  it("missing session → 404, not a 409 suggesting it exists", () => {
    const r = steerRefusal(undefined);
    assert.equal(r?.status, 404);
    assert.match(r!.error, /not found/);
  });

  it("finished session → 409, and the reason says it no longer listens", () => {
    for (const status of ["destroyed", "failed"]) {
      const r = steerRefusal(status);
      assert.equal(r?.status, 409, status);
      assert.match(r!.error, /is over/, status);
    }
  });

  it("waiting → 409, and the reason POINTS to the inbox instead of just saying no", () => {
    const r = steerRefusal(SESSION_STATUS.waiting);
    assert.equal(r?.status, 409);
    assert.match(r!.error, /inbox/);
  });

  it("starting and committing → named 409s (the runtime does not listen yet / anymore)", () => {
    assert.equal(steerRefusal("starting")?.status, 409);
    assert.match(steerRefusal("starting")!.error, /is still starting/);
    assert.equal(steerRefusal("committing")?.status, 409);
    assert.match(steerRefusal("committing")!.error, /pushing/);
  });

  it("an unknown state still refuses, quoting it: never accepted by default", () => {
    const r = steerRefusal("zorglub");
    assert.equal(r?.status, 409);
    assert.match(r!.error, /zorglub/);
  });
});

describe("normalizeSteerText", () => {
  it("trims", () => {
    const r = normalizeSteerText("  change course  ");
    assert.ok(r.ok);
    assert.equal(r.ok && r.text, "change course");
  });

  it("an empty or blank message is not a message", () => {
    for (const bad of ["", "   ", "\n\t"])
      assert.equal(normalizeSteerText(bad).ok, false, JSON.stringify(bad));
  });

  it("refuses what is not a string", () => {
    for (const bad of [undefined, null, 42, {}, ["a"]])
      assert.equal(normalizeSteerText(bad).ok, false, String(bad));
  });

  it("truncates instead of refusing: overly long typing must not be lost", () => {
    const r = normalizeSteerText("x".repeat(STEER_MAX_LEN + 500));
    assert.ok(r.ok);
    assert.equal(r.ok && r.text.length, STEER_MAX_LEN);
    assert.equal(r.ok && r.truncated, true);
  });
});

describe("the injected message queue", () => {
  beforeEach(() => reset());

  it("a message leaves ONCE: the second read does not return it", () => {
    const s = makeSession("s1", "running");
    enqueueSteer(s, "change course");
    assert.equal(pendingSteerCount(s), 1);
    const first = takePendingSteers(s);
    assert.deepEqual(
      first.map((m) => m.text),
      ["change course"],
    );
    assert.deepEqual(takePendingSteers(s), []);
    assert.equal(pendingSteerCount(s), 0);
  });

  it("writing order is delivery order", () => {
    const s = makeSession("s1", "running");
    for (const t of ["one", "two", "three"]) enqueueSteer(s, t);
    assert.deepEqual(
      takePendingSteers(s).map((m) => m.text),
      ["one", "two", "three"],
    );
  });

  it("two sessions' queues do not mix", () => {
    const a = makeSession("sa", "running");
    const b = makeSession("sb", "running");
    enqueueSteer(a, "for a");
    enqueueSteer(b, "for b");
    assert.deepEqual(
      takePendingSteers(a).map((m) => m.text),
      ["for a"],
    );
    assert.deepEqual(
      takePendingSteers(b).map((m) => m.text),
      ["for b"],
    );
  });

  it("a message never delivered stays marked UNDELIVERED: the queue does not lie about what arrived", () => {
    const s = makeSession("s1", "running");
    const kept = enqueueSteer(s, "never read");
    const row = db
      .select()
      .from(schema.sessionSteers)
      .where(eq(schema.sessionSteers.id, kept.id))
      .get();
    assert.equal(row?.deliveredAt, null);
    takePendingSteers(s);
    const after = db
      .select()
      .from(schema.sessionSteers)
      .where(eq(schema.sessionSteers.id, kept.id))
      .get();
    assert.ok(after?.deliveredAt instanceof Date, "delivery must timestamp deliveredAt");
  });

  it("the trace carries the send THEN the delivery: a user turn is never silent", () => {
    const s = makeSession("s1", "running");
    const sent = enqueueSteer(s, "change course");
    const afterSend = replay(s).map((e) => e.type);
    assert.deepEqual(afterSend, ["steer"], "the send enters the trace BEFORE any delivery");
    const payload = replay(s)[0]!.payload as { steerId: string; text: string; source: string };
    assert.equal(payload.text, "change course");
    assert.equal(payload.steerId, sent.id);
    assert.equal(payload.source, "human");

    takePendingSteers(s);
    assert.deepEqual(
      replay(s).map((e) => e.type),
      ["steer", "steer_delivered"],
    );
  });
});

describe("cascade deletion", () => {
  beforeEach(() => reset());

  it("deleting a task that was TALKED to does not break on the foreign key", () => {
    // A new table referencing `sessions` must enter purge.ts, otherwise the first session talked to
    // makes its project and task undeletable (`foreign_keys = ON` fails the whole transaction). The
    // defect does not show at steering time but weeks later, on a delete button answering 500.
    const s = makeSession("s1", "running");
    enqueueSteer(s, "change course");
    assert.doesNotThrow(() => deleteTask(T));
    assert.equal(db.select().from(schema.sessionSteers).all().length, 0);
    assert.equal(db.select().from(schema.sessions).all().length, 0);
  });
});

describe("waitForSteers: the runtime's long poll", () => {
  beforeEach(() => reset());

  it("returns what is already queued at once, without waiting for the window", async () => {
    const s = makeSession("s1", "running");
    enqueueSteer(s, "already there");
    const t0 = Date.now();
    const got = await waitForSteers(s, 5_000);
    assert.deepEqual(
      got.map((m) => m.text),
      ["already there"],
    );
    assert.ok(Date.now() - t0 < 1_000, "must not have waited for the window");
  });

  it("an injection WAKES the ongoing wait instead of letting it expire", async () => {
    const s = makeSession("s1", "running");
    const t0 = Date.now();
    const pending = waitForSteers(s, 10_000);
    setTimeout(() => enqueueSteer(s, "change course"), 20);
    const got = await pending;
    assert.deepEqual(
      got.map((m) => m.text),
      ["change course"],
    );
    assert.ok(
      Date.now() - t0 < 5_000,
      "the wake-up must be immediate, not at the end of the window",
    );
  });

  it("window elapsed with nothing: empty array, not an error but the normal case", async () => {
    const s = makeSession("s1", "running");
    assert.deepEqual(await waitForSteers(s, 30), []);
  });

  it("two concurrent waits cannot duplicate the same message", async () => {
    const s = makeSession("s1", "running");
    const both = Promise.all([waitForSteers(s, 2_000), waitForSteers(s, 2_000)]);
    setTimeout(() => enqueueSteer(s, "unique"), 20);
    const [a, b] = await both;
    assert.equal(a.length + b.length, 1, "only one of the two readers may leave with the message");
  });
});
