// Who the spec entrusts a forge credential to (05/09, audit wave 1; reversed 08/09).
//
// This file said the opposite for three days. Wave 1 added a second condition next to the
// declared forge: the host had to be listed in `LEGION_FORGE_HOSTS`. What it cost on 08/09: a
// framagit.org project, three repositories declared "gitlab", a GITLAB_TOKEN granted to the agent,
// and a clone dying on "could not read Username" because the variable was not set on the server.
// The only diagnostic was a `warn` event nobody reads before the failure.
//
// The rule kept: declaring a repository's forge IS the authorisation. That gesture happens on
// screen, next to the URL just typed, and designates the host as much as it names the token. The
// allowlist now only guards the crate import (`crate-apply.ts`), the one entry whose URL does not
// come from the screen.
//
// The proof is read on the SPEC: what matters is that a container receives what it needs to
// clone, so `runTask` is played in full with an injected runner that keeps the spec.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-forge-scope-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { runTask } = await import("./manager.js");
const { wireFakeRunner } = await import("./test-wiring.js");
const { FORGE_HOSTS_VAR } = await import("../../integrations/forge.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { REPO_ACCESS, RUNNER_KIND } = await import("../../shared/enums.js");

type Spec = import("./types.js").SessionSpec;

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

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
after(() => {
  wireFakeRunner(null);
  delete process.env[FORGE_HOSTS_VAR];
});

function reset(): void {
  const now = new Date();
  delete process.env[FORGE_HOSTS_VAR];
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.repos).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.runners)
    .values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker, lastSeenAt: now })
    .run();
  provisioned = null;
}

/** A repository granted to the agent, with the forge the row DECLARES: exactly what the operator
 *  picks in the menu, next to the URL. */
function seedRepoAndAgent(url: string, forge: "github" | "gitlab"): void {
  const now = new Date();
  db.insert(schema.repos)
    .values({ id: "repo1", projectId: PROJECT, name: "code", url, forge, createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      createdAt: now,
      repoAccess: REPO_ACCESS.read,
      repoNames: JSON.stringify(["code"]),
    })
    .run();
}

/** A repository WITHOUT a declared forge, on a host that reveals none. */
function seedUndeclaredRepoAndAgent(url: string): void {
  const now = new Date();
  db.insert(schema.repos)
    .values({ id: "repo1", projectId: PROJECT, name: "code", url, forge: null, createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      createdAt: now,
      repoAccess: REPO_ACCESS.read,
      repoNames: JSON.stringify(["code"]),
    })
    .run();
}

async function specOf(): Promise<Spec> {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: PROJECT,
      name: "task",
      status: TASK_STATUS.todo,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  await runTask("t1");
  await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
  assert.ok(provisioned, "the fake runner received a spec");
  return provisioned;
}

const repoOf = (spec: Spec) => spec.repos.find((r) => r.name === "code");

describe("the declared forge decides the credential, without a second declaration", () => {
  beforeEach(() => reset());

  // The 08/09 regression test. Without an allowlist, a self-hosted instance declared "gitlab" must
  // receive its credential: the framagit.org failure must not come back through a guard plugged
  // back in "just in case".
  it("a declared self-hosted instance receives its credential, allowlist empty or not", async () => {
    seedRepoAndAgent("https://framagit.org/3idprint/api.git", "gitlab");

    const repo = repoOf(await specOf());
    assert.deepEqual(repo?.credential, { username: "oauth2", tokenEnv: "GITLAB_TOKEN" });
  });

  it("public forges are served the same way: one rule, not two", async () => {
    seedRepoAndAgent("https://gitlab.com/g/p.git", "gitlab");

    const repo = repoOf(await specOf());
    assert.deepEqual(repo?.credential, { username: "oauth2", tokenEnv: "GITLAB_TOKEN" });
  });

  // The guarantee that remains, and makes removing the allowlist bearable: without a DECLARED
  // forge, on a host that reveals none, no token leaves. That refusal keeps a GitHub PAT from landing
  // on an arbitrary host, and it depends on no environment variable, hence on no restart.
  it("a repository without a declared forge carries NO credential", async () => {
    seedUndeclaredRepoAndAgent("https://git.third-party.example/o/r.git");

    const repo = repoOf(await specOf());
    assert.ok(repo, "the repository still goes: public it clones, private it fails plainly");
    assert.equal(repo.credential, undefined, "no token for a forge we cannot name");
  });
});
