// `request_repo` (09/09):
//
//  1. A "yes" GRANTS: the answer puts the repository on the agent record BEFORE the resume, and the
//     waking container's spec carries it. The gap of task ZsbmD_N-zS: a "grant" invented by the
//     agent, picked by the human, honoured by nobody.
//  2. A refusal writes nothing, and the agent reads a refusal telling it what to do (no rogue clone).
//  3. Refusals at REQUEST time are named: unknown repository (with the list), already granted,
//     duplicate.
//  4. The question is an approval: the session goes `blocked`, only a human answers.
//
// Real temporary SQLite, fake runner (`wireFakeRunner`), mock sessions: nothing is spawned, but the
// resume goes through the REAL `resumeSession`, which rereads the record.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-request-repo-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { answerInbox } = await import("../inbox/inbox.js");
const { resumeSession, runTask } = await import("./runner/manager.js");
const { wireFakeRunner } = await import("./runner/test-wiring.js");
const { registerSessionResumer } = await import("../inbox/ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { registerRequestRepoRoute, requestRepoGrant } = await import("./request-repo.js");
const { GRANT_CHOICE } = await import("./repo-grant.js");
const { Hono } = await import("hono");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { REPO_ACCESS, RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";
const GRANTED = "front";
const WANTED = "argo-apps";

type Spec = import("./runner/types.js").SessionSpec;
let provisioned: Spec[] = [];
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned.push(spec);
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.taskActivity).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.notices).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.repos).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  for (const name of [GRANTED, WANTED]) {
    db.insert(schema.repos)
      .values({
        id: `repo-${name}`,
        projectId: PROJECT,
        name,
        url: `https://github.com/acme/${name}.git`,
        createdAt: now,
      })
      .run();
  }
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "dev",
      rolePrompt: "r",
      inboxAccess: true,
      repoAccess: REPO_ACCESS.write,
      repoNames: JSON.stringify([GRANTED]),
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: PROJECT,
      name: "task",
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "s1",
      taskId: "t1",
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: SESSION_STATUS.running,
      callbackToken: "tok",
      mock: true,
      sdkSessionId: "sdk-1",
      startedAt: now,
    })
    .run();
  provisioned = [];
}

const agentRepos = (): string[] =>
  JSON.parse(
    db.select().from(schema.agents).where(eq(schema.agents.id, AGENT)).get()!.repoNames,
  ) as string[];
const session = () => db.select().from(schema.sessions).where(eq(schema.sessions.id, "s1")).get()!;
const inbox = () =>
  db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.sessionId, "s1")).all();
const ask = (repo: string, why = "x") => requestRepoGrant("s1", { repo, why });
const inboxIdOf = (res: ReturnType<typeof requestRepoGrant>): string => (res.ok ? res.inboxId : "");

describe("request_repo: the request", () => {
  beforeEach(() => reset());

  it("blocks the session on an approval carrying the repository name", () => {
    const res = ask(WANTED, "spec.md §6: the whole diff is in argo-apps");
    assert.equal(res.ok, true);
    assert.equal(session().status, SESSION_STATUS.blocked);
    const [msg] = inbox();
    assert.equal(msg!.grantRepoName, WANTED);
    assert.equal(msg!.status, "open");
    assert.match(msg!.body, /argo-apps/);
    assert.match(msg!.evidence ?? "", /§6/);
    assert.deepEqual(
      (JSON.parse(msg!.choices ?? "[]") as { id: string }[]).map((c) => c.id),
      [GRANT_CHOICE.grant, GRANT_CHOICE.refuse],
    );
    assert.deepEqual(agentRepos(), [GRANTED], "asking grants nothing");
  });

  it("an unknown repository is refused naming the project's ones", () => {
    const res = ask("nope");
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.status, 404);
    assert.match(!res.ok ? res.error : "", /argo-apps, front/);
    assert.equal(inbox().length, 0);
  });

  it("an already granted repository is refused: it is already there", () => {
    const res = ask(GRANTED);
    assert.equal(!res.ok && res.status, 409);
    assert.match(!res.ok ? res.error : "", /already granted/);
  });

  it("one open request per session", () => {
    assert.equal(ask(WANTED).ok, true);
    db.update(schema.sessions)
      .set({ status: SESSION_STATUS.running })
      .where(eq(schema.sessions.id, "s1"))
      .run();
    const res = ask(WANTED);
    assert.equal(!res.ok && res.status, 409);
    assert.match(!res.ok ? res.error : "", /already pending/);
  });
});

describe("request_repo: the answer", () => {
  beforeEach(() => reset());

  it("grant puts the repository on the record BEFORE the resume, and the resume carries it", async () => {
    const inboxId = inboxIdOf(ask(WANTED));
    const text = await answerInbox(inboxId, { choiceId: GRANT_CHOICE.grant });
    assert.deepEqual(agentRepos(), [GRANTED, WANTED]);
    assert.match(text, /GRANTED/);
    assert.match(text, new RegExp(`repos/${WANTED}`));
    // The resume reread the record: the repository is in the waking container's spec.
    const spec = provisioned.at(-1);
    assert.ok(spec, "the session was resumed");
    assert.deepEqual((spec.repos ?? []).map((r) => r.name).sort(), [GRANTED, WANTED].sort());
    assert.equal(inbox()[0]!.status, "answered");
  });

  it("refuse writes nothing, and the agent reads what to do", async () => {
    const text = await answerInbox(inboxIdOf(ask(WANTED)), { choiceId: GRANT_CHOICE.refuse });
    assert.deepEqual(agentRepos(), [GRANTED]);
    assert.match(text, /REFUSED/);
    assert.match(text, /Do not clone it yourself/);
  });

  it("free text is a reasoned refusal, never a grant", async () => {
    const text = await answerInbox(inboxIdOf(ask(WANTED)), {
      text: "not that one, look in front/infra",
    });
    assert.deepEqual(agentRepos(), [GRANTED]);
    assert.match(text, /REFUSED by the operator: not that one/);
  });
});

describe("request_repo: the /internal port route", () => {
  beforeEach(() => reset());
  const app = new Hono();
  registerRequestRepoRoute(app);
  const post = (body: unknown, token = "tok") =>
    app.request("/internal/sessions/s1/request-repo", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("the session token is authoritative, as on the port's other routes", async () => {
    assert.equal((await post({ repo: WANTED, why: "x" }, "wrong")).status, 401);
    assert.equal(inbox().length, 0);
  });

  it("a body outside the contract is refused naming the key", async () => {
    const res = await post({ repo: WANTED, why: "x", reason: "operator-pause" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /reason/);
  });

  it("a valid request returns the entry id, and the session is blocked", async () => {
    const res = await post({ repo: WANTED, why: "spec §6" });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { ok: boolean; inboxId: string };
    assert.equal(body.inboxId, inbox()[0]!.id);
    assert.equal(session().status, SESSION_STATUS.blocked);
  });

  it("the service's refusals travel with their status", async () => {
    const res = await post({ repo: "nope", why: "x" });
    assert.equal(res.status, 404);
    assert.match(((await res.json()) as { error: string }).error, /repos of the project/);
  });
});
