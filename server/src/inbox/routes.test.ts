// The inbox's mutating routes through HTTP (06/09): the human answer crosses Hono, and the schema
// refuses an invented key by name instead of passing it to `answerInbox`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerInboxRoutes } = await import("./routes.js");
const { addNotice, createInboxMessage } = await import("./inbox.js");
const { validateFormSpec } = await import("./inbox-form.js");
const { INBOX_KIND, INBOX_STATUS } = await import("./inbox-enums.js");
const { resumeSession, runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
const { registerSessionResumer } = await import("./ports.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
// Answering resumes through `SessionResumer`, wired by `index.ts`; a bare Hono lacks it, and the
// route would turn "not wired" into a 400 that looks like a business refusal. Wire the real
// runner, with no container behind it.
registerSessionResumer({ resume: resumeSession, run: runTask });
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

const app = new Hono();
app.use("*", mutationOriginGuard);
registerInboxRoutes(app);

const P1 = "p1";
const A1 = "a1";
const R1 = "r1";
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const patch = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const ask = () =>
  createInboxMessage("s1", {
    kind: INBOX_KIND.choice,
    body: "which way do we go?",
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  });
/** A round: two fields, the shape for the dedicated page (07/09). */
const askRound = () =>
  createInboxMessage("s1", {
    kind: INBOX_KIND.form,
    body: "Round 1 — 2 questions",
    form: validateFormSpec({
      blocks: [
        {
          kind: "field",
          field: {
            id: "place",
            label: "Placement",
            type: "radio",
            options: [
              { id: "menu", label: "Menu" },
              { id: "bar", label: "Bar" },
            ],
          },
        },
        { kind: "field", field: { id: "scope", label: "Scope", type: "text" } },
      ],
    }),
  });

beforeEach(() => {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.notices).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P1, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: A1,
      projectId: P1,
      name: "agent",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: R1, name: R1, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: P1,
      name: "task",
      status: TASK_STATUS.doing,
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "s1",
      taskId: "t1",
      agentId: A1,
      runnerId: R1,
      model: "m",
      status: "running",
      callbackToken: "tok",
      mock: true,
      sdkSessionId: "sdk",
      startedAt: now,
    })
    .run();
});

describe("answering a question", () => {
  it("a known choice closes the question and returns the answer", async () => {
    const q = ask();
    const res = await post(`/api/inbox/${q.id}/reply`, { choiceId: "a" });
    assert.equal(res.status, 200);
    // The choice label, not its id: what the human read.
    assert.equal(((await res.json()) as { answer: string }).answer, "A");
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, q.id))
      .get()!;
    assert.equal(row.status, INBOX_STATUS.answered);
  });

  it("refuses a key the screen may not set, naming it", async () => {
    const q = ask();
    // `wakeAt` belongs to the control plane.
    const res = await post(`/api/inbox/${q.id}/reply`, { choiceId: "a", wakeAt: 0 });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /wakeAt/);
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, q.id))
      .get()!;
    assert.equal(row.status, INBOX_STATUS.open, "the question stays open");
  });

  it("refuses an unknown choice in `inbox.ts`, writing nothing", async () => {
    const q = ask();
    const res = await post(`/api/inbox/${q.id}/reply`, { choiceId: "zzz" });
    assert.equal(res.status, 400);
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, q.id))
      .get()!;
    assert.equal(row.answeredAt, null);
  });

  it("answers 400 for a question that does not exist", async () => {
    assert.equal((await post("/api/inbox/ghost/reply", { text: "yes" })).status, 400);
  });

  it("stops an answer from another origin in the middleware", async () => {
    const q = ask();
    assert.equal(
      (await post(`/api/inbox/${q.id}/reply`, { text: "yes" }, { origin: "https://evil.example" }))
        .status,
      403,
    );
  });
});

describe("GET /api/inbox/:id (07/09)", () => {
  it("returns the question, its task and its rounds", async () => {
    const q = askRound();
    const res = await app.request(`/api/inbox/${q.id}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      id: string;
      task: { name: string };
      rounds: { id: string }[];
    };
    assert.equal(body.id, q.id);
    assert.equal(body.task.name, "task");
    assert.deepEqual(
      body.rounds.map((r) => r.id),
      [q.id],
    );
  });

  it("does not read `pending-by-project` as an id", async () => {
    // Declaration order in `routes.ts` holds this.
    const res = await app.request("/api/inbox/pending-by-project");
    assert.equal(res.status, 200);
    assert.equal(typeof (await res.json()), "object");
  });

  it("answers 404, not 500, for an unknown id", async () => {
    assert.equal((await app.request("/api/inbox/never-seen")).status, 404);
  });
});

describe("PATCH /api/inbox/:id/draft (07/09)", () => {
  it("saves and returns the count", async () => {
    const q = askRound();
    const res = await patch(`/api/inbox/${q.id}/draft`, { formData: { place: "menu" } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, answered: 1, total: 2 });
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, q.id))
      .get()!;
    assert.deepEqual(JSON.parse(row.draft!), { place: "menu" });
    assert.equal(row.status, INBOX_STATUS.open, "a draft does not answer the question");
  });

  it("refuses an extra envelope key, naming it", async () => {
    const q = askRound();
    const res = await patch(`/api/inbox/${q.id}/draft`, { formData: {}, answer: "yes" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /answer/);
  });

  it("refuses an undeclared key, leaving the row intact", async () => {
    const q = askRound();
    const res = await patch(`/api/inbox/${q.id}/draft`, { formData: { invented: "x" } });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /unknown/);
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, q.id))
      .get()!;
    assert.equal(row.draft, null);
  });

  it("answers 409 on an already answered question: a state conflict", async () => {
    const q = askRound();
    await post(`/api/inbox/${q.id}/reply`, { formData: { place: "menu", scope: "customers" } });
    const res = await patch(`/api/inbox/${q.id}/draft`, { formData: { place: "bar" } });
    assert.equal(res.status, 409);
    assert.match(await errorOf(res), /is no longer open/);
  });

  it("answers 404 for a question that does not exist", async () => {
    assert.equal((await patch("/api/inbox/ghost/draft", { formData: {} })).status, 404);
  });

  it("clears the draft on answer, or the card would show 1 / 2 after sending", async () => {
    const q = askRound();
    await patch(`/api/inbox/${q.id}/draft`, { formData: { place: "menu" } });
    await post(`/api/inbox/${q.id}/reply`, { formData: { place: "menu", scope: "customers" } });
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, q.id))
      .get()!;
    assert.equal(row.status, INBOX_STATUS.answered);
    assert.equal(row.draft, null);
    assert.equal(row.draftAt, null);
  });

  it("stops a draft from another origin in the middleware", async () => {
    const q = askRound();
    const res = await patch(
      `/api/inbox/${q.id}/draft`,
      { formData: {} },
      { origin: "https://evil.example" },
    );
    assert.equal(res.status, 403);
  });
});

describe("marking a notice read", () => {
  it("removes the notice from the unread list", async () => {
    addNotice("the morning standup", "standup");
    const [notice] = (await (await app.request("/api/notices")).json()) as { id: string }[];
    assert.ok(notice, "the notice is there before being read");

    assert.deepEqual(await (await post(`/api/notices/${notice.id}/read`)).json(), { ok: true });
    assert.deepEqual(await (await app.request("/api/notices")).json(), []);
  });
});
