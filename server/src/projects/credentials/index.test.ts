// The credentials store and its routes: what touches the database, so what pure resolution cannot
// prove alone. Two properties matter:
//
//  · The value never leaves. A token in a list response is a leak no type reports, hence the
//    assertion on the whole serialized body.
//  · Rank stays an order. After a move or delete, ranks are 1..n with no gap or duplicate. A gap
//    reads as "an account vanished"; a duplicate would make resolution depend on SQLite's read order.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-credentials-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0".repeat(64);
// The control plane has no credential in these tests: the fallback must be empty, or a project
// without a token would pass as authenticated by the test machine's environment.
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { registerProjectRoutes } = await import("../routes.js");
const { recordExhaustion } = await import("./index.js");
const { resolveProjectCredential } = await import("../auth.js");

const app = new Hono();
registerProjectRoutes(app);

const PROJECT = "prj-credentials";
const OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
const HOUR = 3_600_000;

type Listed = {
  credentials: {
    id: string;
    name: string;
    rank: number;
    label: string | null;
    exhausted: { window: string | null; until: string }[];
  }[];
  active: {
    credentialId: string | null;
    from: string;
    name: string | null;
    label: string | null;
    available: boolean;
    retryAt: string | null;
  };
};

const post = (body: Record<string, unknown>) =>
  app.request(`/api/projects/${PROJECT}/credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const patch = (id: string, body: Record<string, unknown>) =>
  app.request(`/api/credentials/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const list = async (): Promise<Listed> =>
  (await (await app.request(`/api/projects/${PROJECT}/credentials`)).json()) as Listed;
const ranks = async (): Promise<string[]> =>
  (await list()).credentials.map((c) => `${c.rank}:${c.label}`);

before(() => {
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "Kopee", slug: "kopee-cred", createdAt: new Date() })
    .run();
});

describe("a project's credentials", () => {
  it("are added last: the account in use does not move", async () => {
    assert.equal((await post({ value: "sk-ant-oat-perso", label: "Personal" })).status, 201);
    const second = await post({ value: "sk-ant-oat-pro", label: "Pro" });
    assert.equal(second.status, 201);
    assert.equal(((await second.json()) as { rank: number }).rank, 2);
    assert.deepEqual(await ranks(), ["1:Personal", "2:Pro"]);
  });

  it("two tokens coexist: all this table adds to `secrets`", async () => {
    // In `secrets`, `putSecret` upserts by name: the second token would have silently erased the
    // first. That is why this module exists.
    assert.equal((await list()).credentials.length, 2);
  });

  it("never returns a value, not even an excerpt", async () => {
    const body = await (await app.request(`/api/projects/${PROJECT}/credentials`)).text();
    assert.ok(!body.includes("sk-ant-oat"), "no trace of the token in the response");
    assert.ok(body.includes("Personal"), "the label does leave: it names the account");
  });

  it("refuses a ranked API key, saying where it goes", async () => {
    const res = await post({ value: "sk-api", name: "ANTHROPIC_API_KEY" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /project secrets/);
  });

  it("renames without re-pasting the token", async () => {
    const id = (await list()).credentials[1]!.id;
    assert.equal((await patch(id, { label: "Pro (team)" })).status, 200);
    assert.deepEqual(await ranks(), ["1:Personal", "2:Pro (team)"]);
  });

  it("moves, and the list stays numbered 1..n", async () => {
    await post({ value: "sk-ant-oat-3", label: "Test" });
    const pro = (await list()).credentials.find((c) => c.label === "Pro (team)")!;
    assert.equal((await patch(pro.id, { rank: 1 })).status, 200);
    assert.deepEqual(await ranks(), ["1:Pro (team)", "2:Personal", "3:Test"]);
  });

  it("an out-of-bounds rank goes last rather than opening a gap", async () => {
    const personal = (await list()).credentials.find((c) => c.label === "Personal")!;
    await patch(personal.id, { rank: 99 });
    assert.deepEqual(await ranks(), ["1:Pro (team)", "2:Test", "3:Personal"]);
  });

  it("is removed, and the rest renumbers", async () => {
    const test = (await list()).credentials.find((c) => c.label === "Test")!;
    assert.equal(
      (await app.request(`/api/credentials/${test.id}`, { method: "DELETE" })).status,
      200,
    );
    assert.deepEqual(await ranks(), ["1:Pro (team)", "2:Personal"]);
  });

  it("404 on a credential that does not exist", async () => {
    assert.equal((await app.request("/api/credentials/unknown", { method: "DELETE" })).status, 404);
    assert.equal((await patch("unknown", { label: "x" })).status, 404);
  });
});

describe("exhaustion, end to end", () => {
  it("skips exhausted rank 1 and names the account taking over", async () => {
    const [premier, second] = (await list()).credentials;
    recordExhaustion(premier!.id, "five_hour", new Date(Date.now() + 2 * HOUR));

    const active = (await list()).active;
    assert.equal(active.credentialId, second!.id, "rank 2 serves");
    assert.equal(active.label, "Personal");
    assert.equal(active.available, true);
    assert.equal(
      resolveProjectCredential(PROJECT).env[OAUTH],
      "sk-ant-oat-perso",
      "and its own value is injected",
    );
  });

  it("says which window and until when: the UI has nothing to recompute", async () => {
    const premier = (await list()).credentials[0]!;
    assert.equal(premier.exhausted[0]?.window, "five_hour");
    assert.equal(
      premier.exhausted.length,
      1,
      "a bare time would not say whether the wait is 5 h or six days",
    );
  });

  it("the latest closed window replaces the previous one: one time per account", async () => {
    // Per-window storage was removed on 08/09: exhaustion is only discovered by using the account,
    // which only happens when it is free, so two windows cannot be closed at once. The latest known
    // time is right, and the array keeps one element.
    const premier = (await list()).credentials[0]!;
    recordExhaustion(premier.id, "seven_day", new Date(Date.now() + 3 * 24 * HOUR));
    const after = (await list()).credentials[0]!;
    assert.equal(after.exhausted.length, 1);
    assert.equal(after.exhausted[0]?.window, "seven_day");
    assert.ok(new Date(after.exhausted[0]!.until).getTime() > Date.now() + 2 * 24 * HOUR);
  });

  it("a past time closes nothing: the column is not purged, it stops being read", async () => {
    const premier = (await list()).credentials[0]!;
    recordExhaustion(premier.id, "five_hour", new Date(Date.now() - 60_000));
    assert.deepEqual((await list()).credentials[0]!.exhausted, []);
    assert.equal((await list()).active.credentialId, premier.id, "and rank 1 is back in place");
    // These cases share state: close rank 1 again for the next test, which needs all exhausted.
    recordExhaustion(premier.id, "five_hour", new Date(Date.now() + 2 * HOUR));
  });

  it("all exhausted: no account available, and the time of the first reset", async () => {
    const [premier, second] = (await list()).credentials;
    recordExhaustion(second!.id, "five_hour", new Date(Date.now() + HOUR));
    const active = (await list()).active;
    assert.equal(active.available, false, "sleep: there is no unlimited last resort");
    assert.equal(active.credentialId, second!.id, "resumes on the first to reopen");
    assert.ok(Date.parse(active.retryAt!) <= Date.now() + HOUR + 1000);
    // Rank 1, dead until next week, is not the one waited for.
    assert.notEqual(active.credentialId, premier!.id);
  });

  it("is removed even if sessions ran on it", async () => {
    // `sessions.credential_id` deliberately has no foreign key: a cascade would delete sessions, a
    // `SET NULL` would erase their cost attribution, and a bare constraint would forbid removing an
    // account once it has served.
    const added = (await (
      await post({ value: "sk-ant-oat-disposable", label: "Disposable" })
    ).json()) as { id: string };
    const now = new Date();
    db.insert(schema.agents)
      .values({ id: "a", projectId: PROJECT, name: "agent", rolePrompt: "r", createdAt: now })
      .run();
    db.insert(schema.runners).values({ id: "r", name: "r", kind: "process" }).run();
    db.insert(schema.tasks)
      .values({ id: "t-cred", projectId: PROJECT, name: "t", createdAt: now, updatedAt: now })
      .run();
    db.insert(schema.sessions)
      .values({
        id: "sess-cred",
        taskId: "t-cred",
        agentId: "a",
        runnerId: "r",
        model: "m",
        callbackToken: "tok",
        startedAt: new Date(),
        credentialId: added.id,
      })
      .run();
    assert.equal(
      (await app.request(`/api/credentials/${added.id}`, { method: "DELETE" })).status,
      200,
    );
    const session = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "sess-cred"))
      .get();
    assert.equal(session?.credentialId, added.id, "the session keeps the account it spent");
  });

  it("exhaustion state goes with the credential: it lives in its row", async () => {
    // Since the reopening time is a column rather than a child table there can be no orphan; this
    // test pins it so a return to a table does not silently bring orphans back.
    const second = (await list()).credentials[1]!;
    recordExhaustion(second.id, "five_hour", new Date(Date.now() + 3_600_000));
    await app.request(`/api/credentials/${second.id}`, { method: "DELETE" });
    assert.equal(
      db
        .select()
        .from(schema.credentials)
        .all()
        .some((c) => c.id === second.id),
      false,
      "the row is gone, and its time with it",
    );
  });
});
