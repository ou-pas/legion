// The global control stream (02/09). Three properties:
//
//  1. Filtering. An event that makes no screen stale never leaves the server; otherwise every
//     session `text` would wake every open tab and the stream would cost more than the polling
//     it replaces.
//  2. No body. The stream never carries a task brief, an inbox answer or a written path. Only a
//     test comparing the EXACT field list holds this; a "does not contain" assertion would let the
//     next convenience field through.
//  3. Heartbeat. Intermediaries silently cut idle streams, a failure that looks like "nothing is
//     happening" on screen.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-events-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { publish } = await import("../shared/events.js");
const { CONTROL_EVENT_TYPES, subscribeControl, toControlEvent } =
  await import("./control-stream.js");
const { registerEventRoutes } = await import("./routes.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p-ev",
  A = "a-ev",
  T = "t-ev",
  R = "r-ev",
  S = "s-ev";
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
  db.insert(schema.sessions)
    .values({
      id: S,
      taskId: T,
      agentId: A,
      runnerId: R,
      status: "running",
      model: "sonnet",
      callbackToken: `tok-${S}`,
      startedAt: now,
    })
    .run();
}

describe("projection: a bus event becomes a signal, or nothing", () => {
  beforeEach(reset);

  it("carries the session's task and project, never the event body", () => {
    const ev = toControlEvent(S, {
      dbId: 1,
      type: "task_status",
      payload: { status: TASK_STATUS.review, secret: "x" },
      ts: 42,
    });
    assert.deepEqual(ev, { type: "task_status", sessionId: S, taskId: T, projectId: P, ts: 42 });
  });

  it("a type outside the list becomes nothing", () => {
    for (const type of ["text", "tool_start", "tool_end", "activity", "steer"])
      assert.equal(toControlEvent(S, { dbId: 1, type, payload: { text: "blah" }, ts: 1 }), null);
  });

  it("an unknown session still passes, without ids", () => {
    const ev = toControlEvent("s-ghost", { dbId: 1, type: "result", payload: {}, ts: 7 });
    assert.deepEqual(ev, {
      type: "result",
      sessionId: "s-ghost",
      taskId: null,
      projectId: null,
      ts: 7,
    });
  });

  it("every allowlisted type goes through `publish`, and only those", () => {
    const seen: string[] = [];
    const stop = subscribeControl((ev) => seen.push(ev.type));
    for (const type of CONTROL_EVENT_TYPES) publish(S, type, { body: "ignored" });
    publish(S, "text", { text: "blah" });
    stop();
    assert.deepEqual(seen, [...CONTROL_EVENT_TYPES]);
  });

  it("once the last subscriber leaves, nothing arrives", () => {
    const seen: string[] = [];
    const stop = subscribeControl((ev) => seen.push(ev.type));
    stop();
    publish(S, "task_status", { status: TASK_STATUS.done });
    assert.deepEqual(seen, []);
  });

  // The copy is deliberate: iterating the constant would not see an accidental removal, and a
  // type added without thought must cost a test line.
  it("the list is exactly this, no type more, no type less", () => {
    assert.deepEqual(
      [...CONTROL_EVENT_TYPES],
      [
        "status",
        "task_status",
        "task_proposed",
        "result",
        "run_error",
        // `inbox_draft` (07/09): a round started elsewhere turns "0 / 6 · Answer" into
        // "2 / 6 · Resume" on four surfaces. Without it they waited for the 60 s fallback.
        "inbox_ask",
        "inbox_answer",
        "inbox_note",
        "inbox_draft",
        "dependency_wait",
        "dependency_resolved",
        "repo_push",
        "repo_push_failed",
        "fs_op",
      ],
    );
  });
});

/** Bounded: without a timeout, a test waiting for a line that never comes hangs and nobody
 *  knows which one. */
async function nextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  label: string,
): Promise<string> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`nothing received on the stream: ${label}`)), 2_000).unref(),
  );
  const { value } = await Promise.race([reader.read(), timeout]);
  return new TextDecoder().decode(value);
}

describe("GET /api/events: the stream", () => {
  beforeEach(reset);

  it("opens with a heartbeat, then pushes the signal without its body", async () => {
    const app = new Hono();
    registerEventRoutes(app);
    const res = await app.request("/api/events");
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const reader = res.body!.getReader();
    // The first byte arrives BEFORE any event: it is what makes the browser go `open` on an
    // idle control plane.
    assert.equal(await nextChunk(reader, "opening heartbeat"), ": ping\n\n");

    publish(S, "inbox_ask", { question: "some secret", inboxId: "i-1" });
    const line = await nextChunk(reader, "inbox_ask");
    const data = JSON.parse(line.replace(/^data: /, "").trim()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(data).sort(), ["projectId", "sessionId", "taskId", "ts", "type"]);
    assert.equal(data.type, "inbox_ask");
    assert.equal(data.taskId, T);
    assert.equal(data.projectId, P);
    assert.equal(data.sessionId, S);
    // Neither the body nor an `id:`: there is nothing to resume on this stream.
    assert.ok(!line.includes("secret"));
    assert.ok(!line.includes("id: "));
    await reader.cancel();
  });

  it("beats on its own when nothing happens", async () => {
    const app = new Hono();
    registerEventRoutes(app, { heartbeatMs: 20 });
    const res = await app.request("/api/events");
    const reader = res.body!.getReader();
    for (const n of [1, 2, 3])
      assert.equal(await nextChunk(reader, `heartbeat ${n}`), ": ping\n\n");
    await reader.cancel();
  });

  it("an event from ANOTHER session still arrives: the stream is global", async () => {
    const app = new Hono();
    registerEventRoutes(app);
    const res = await app.request("/api/events");
    const reader = res.body!.getReader();
    await nextChunk(reader, "opening heartbeat");
    db.insert(schema.sessions)
      .values({
        id: "s-other",
        taskId: T,
        agentId: A,
        runnerId: R,
        status: "running",
        model: "sonnet",
        callbackToken: "tok-other",
        startedAt: now,
      })
      .run();
    publish("s-other", "repo_push", { branch: "feature/x" });
    const data = JSON.parse(
      (await nextChunk(reader, "repo_push")).replace(/^data: /, "").trim(),
    ) as Record<string, unknown>;
    assert.equal(data.type, "repo_push");
    assert.equal(data.sessionId, "s-other");
    await reader.cancel();
  });
});
