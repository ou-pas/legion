// `POST /api/sessions/:id/steer`: the body, seen through HTTP (06/09).
//
// `steering.ts` tests text normalisation and the refusal outside `running`; nobody opened the port.
// The body arrived through `c.req.json<{ text?: unknown }>().catch(() => ({}))`: an `as` on network
// input, plus a silent fallback to an empty object. Since wave 2 it is a schema, and
// `normalizeSteerText` keeps its job (trim, refuse empty, truncate).
//
// The order of the two refusals matters, and the first case pins it: a session that no longer
// listens is refused BEFORE the body is looked at. Otherwise a message sent at the wrong moment
// would be corrected on its shape while the real reason stayed invisible.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-steer-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerSessionRoutes } = await import("./routes.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerSessionRoutes(app);

const steer = (body?: unknown, id = "s1", headers: Record<string, string> = {}) =>
  app.request(`/api/sessions/${id}/steer`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

beforeEach(() => {
  const now = new Date();
  // `enqueueSteer` also publishes a session event (never silent): without this cleanup, the foreign
  // key blocks deleting the session in the next case.
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: "p1", name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: "a1", projectId: "p1", name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: "p1",
      name: "t",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "s1",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: "running",
      callbackToken: "tok",
      mock: true,
      startedAt: now,
    })
    .run();
});

describe("telling a running agent something", () => {
  it("the happy path: 201, the message is trimmed and queued", async () => {
    const res = await steer({ text: "  think about the tests too  " });
    assert.equal(res.status, 201);
    const out = (await res.json()) as { steerId: string; text: string; truncated: boolean };
    assert.equal(out.text, "think about the tests too");
    assert.equal(out.truncated, false);
    assert.equal(db.select().from(schema.sessionSteers).all().length, 1);
  });

  it("an empty message is refused by `steering.ts`, with its sentence", async () => {
    const res = await steer({ text: "   " });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /empty message/);
    assert.equal(db.select().from(schema.sessionSteers).all().length, 0);
  });

  it("missing `text` is refused by the SCHEMA naming the key, no longer swallowed as `{}`", async () => {
    const res = await steer({});
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /text/);
  });

  it("an invented key is refused BY NAME", async () => {
    const res = await steer({ text: "ok", priority: "high" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /priority/);
  });

  it("a finished session is refused BEFORE the body: the real reason we want to read", async () => {
    db.update(schema.sessions).set({ status: "destroyed" }).run();
    const res = await steer({ whatever: "value" });
    assert.equal(res.status, 409);
    assert.doesNotMatch(
      await errorOf(res),
      /whatever/,
      "no correcting the shape of a message that has no recipient left",
    );
  });

  it("a message from another origin is stopped by the middleware", async () => {
    assert.equal(
      (await steer({ text: "ok" }, "s1", { origin: "https://evil.example" })).status,
      403,
    );
  });
});
