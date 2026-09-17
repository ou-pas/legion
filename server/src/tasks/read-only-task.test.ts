// The read-only task (v53), checked where it acts: in the session spec. The boolean does not set an
// instruction, it lowers the right (`access: "read"` on each repository), because everything that
// pushes in the container (checkpoint, catch-up commit, push) is guarded by `access === "write"`,
// and the automatic PR needs a traced push. Born from the Kopee canary task (02/09): "push NOTHING"
// written in the brief still ended in an MR of regenerated lockfiles; an instruction does not hold
// the safety nets, a right does.
//
// Same harness as `attachments-spec.test.ts`: a fake runner captures the provisioned spec.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-read-only-task-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerTaskRoutes } = await import("./routes/index.js");
const { runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { REPO_ACCESS } = await import("../shared/enums.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
let provisioned: Spec | null = null;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned = spec;
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

const app = new Hono();
registerTaskRoutes(app);

const PROJECT = "p1";
const AGENT = "a1";

const now = new Date();
db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
// An agent allowed to write: that is what the boolean must lower, otherwise the test only proves an
// agent already reading. The repository is on github and the token granted, so the control case
// (write) passes preflight; the contrast proves the lowering.
db.insert(schema.agents)
  .values({
    id: AGENT,
    projectId: PROJECT,
    name: "agent",
    rolePrompt: "r",
    repoAccess: REPO_ACCESS.write,
    repoNames: JSON.stringify(["front"]),
    envSecretNames: JSON.stringify(["GITHUB_TOKEN"]),
    createdAt: now,
  })
  .run();
db.insert(schema.repos)
  .values({
    id: "repo1",
    projectId: PROJECT,
    name: "front",
    url: "https://github.com/acme/front.git",
    createdAt: now,
  })
  .run();
db.insert(schema.secrets)
  .values({
    id: "s1",
    projectId: PROJECT,
    name: "GITHUB_TOKEN",
    ciphertext: "AAAA",
    createdAt: now,
  })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "local", kind: RUNNER_KIND.process }).run();

/** Creates a task through the route (like the composer) and returns its JSON. */
async function createTask(body: Record<string, unknown>): Promise<{ status: number; task: any }> {
  const res = await app.request("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT, agentId: AGENT, ...body }),
  });
  return { status: res.status, task: res.status === 201 ? await res.json() : await res.json() };
}

describe("read-only task (v53): the boolean lowers the right, not the instruction", () => {
  it("is set at creation, read in the response, and false by default", async () => {
    const ro = await createTask({ name: "audit", readOnly: true });
    assert.equal(ro.status, 201, JSON.stringify(ro.task));
    assert.equal(ro.task.readOnly, true);

    const normal = await createTask({ name: "work" });
    assert.equal(normal.status, 201);
    assert.equal(normal.task.readOnly, false);

    const bad = await createTask({ name: "shady", readOnly: "yes" });
    assert.equal(bad.status, 400);
  });

  it("lowers a writer agent's repositories to read access, says so in the brief, and asks for no pr.md", async () => {
    const { task } = await createTask({ name: "check the clone", readOnly: true });
    // mock: no secret, no network; reading PR title examples need not start from here.
    await runTask(task.id, { mock: true });
    assert.ok(provisioned, "no session provisioned");
    const spec = provisioned;

    assert.equal(spec.repos.length, 1);
    assert.equal(spec.repos[0]!.access, "read");
    // The brief says so: an agent unaware of its right burns rounds understanding a refusal.
    assert.match(spec.taskDescription, /## Read-only task/);
    assert.doesNotMatch(spec.taskDescription, /## Pull request draft/);
  });

  it("changes nothing for an ordinary task of the same agent", async () => {
    const { task } = await createTask({ name: "real work" });
    await runTask(task.id, { mock: true });
    const spec = provisioned!;

    assert.equal(spec.repos[0]!.access, "write");
    assert.doesNotMatch(spec.taskDescription, /## Read-only task/);
  });
});

// Commit as you go (04/09).
//
// What motivated the instruction: whole PRs whose history was only a run of "chore: checkpoint
// (round 45/60/75/90) — session …". The `session-runner.mjs` net only commits on a dirty tree, so
// four checkpoints in a row say one thing: the agent never committed itself, and fifteen rounds of
// work left in one block under a message saying nothing.
//
// Not an agent defect: the prompt said how to write a commit message (the `commits-conventionnels`
// rule + repository examples) and never when to commit.
//
// This test holds the instruction where it acts (the session spec), because a prompt paragraph is
// what gets lost most easily at the next refactor.
describe("commit as you go (04/09): the instruction that silences the checkpoint", () => {
  it("is in an ordinary task's brief", async () => {
    const { task } = await createTask({ name: "some work" });
    await runTask(task.id, { mock: true });
    const d = provisioned!.taskDescription;

    assert.match(d, /## Commits/);
    assert.match(d, /Commit as you go/);
    // The why matters as much as the instruction: without it, it reads as paperwork and gets skipped
    // on the first tight round.
    assert.match(d, /checkpoint/, "the instruction must say what happens to uncommitted work");
  });

  it("names the one combination a reviewer cannot untangle", async () => {
    // "one commit per coherent change" is too vague to apply. The hard case is named: refactor +
    // behaviour change in the same commit.
    const { task } = await createTask({ name: "more work" });
    await runTask(task.id, { mock: true });
    assert.match(provisioned!.taskDescription, /refactor with a behaviour change/);
  });

  it("is not in a read-only task's brief", async () => {
    // Its repositories are lowered to `access: "read"`: nothing can be committed, and a commit
    // instruction would be impossible to follow, exactly what makes a trying agent lose rounds.
    const { task } = await createTask({ name: "an audit", readOnly: true });
    await runTask(task.id, { mock: true });
    assert.doesNotMatch(provisioned!.taskDescription, /## Commits/);
  });
});
