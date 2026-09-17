// Where a session's artifacts land, and why the machine running it changes nothing (multi-machine
// work, slice 03, 01/09).
//
// Slice 03 started from a wrong deduction, and this file is what remains of it. The SPEC's tie no. 2
// is true ("artifacts are READ from the local disk, `taskArtifactsDir`"), but the rest does not
// follow ("so a remote session writes them elsewhere, so they must be copied back with `docker cp`
// before the container is destroyed"). There is nothing to copy back: an artifact NEVER exists in
// the container.
//
// The real path. The payload does not write artifacts to its disk: it calls
// `POST /internal/sessions/:id/fs` (`fsTool`, `callInternal` and the mock mode writes in the
// payload), the route checks the ACL and `fsExec` writes under `projectRoot()`, on the CONTROL
// PLANE's disk. `/artifacts/<scope>` is not a container path but a path in the project's ACL
// namespace (`tasks/artifacts/scope.ts`), mounted by no `-v` (`runner/remote-mounts.test.ts` pins
// the exact mounts on both paths).
//
// So the channel survives the move without a line of code: it is the SAME one carrying the spec at
// boot (`LEGION_SPEC_URL`), events, status changes and the inbox. A session whose pipe does not pass
// does not start at all, so artifacts add no connectivity requirement.
//
// What this test would catch: the day someone moves artifact writes to the session filesystem (for
// convenience, for binaries `fsExec` refused, or by unifying `/workspace` and `/artifacts`), this
// test fails, on the right side: that move would not meet a copy-back need, it would CREATE one.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-artifacts-location-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerInternalRoutes } = await import("./internal-routes.js");
const { taskArtifactsDir } = await import("../tasks/artifacts/dir.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerInternalRoutes(app);

const PROJECT = "p1";
const AGENT = "a1";

/** Two sessions identical but for one detail, which is the WHOLE work stream: their runner's
 *  `docker_host`, the only thing deciding whether a session's files live on this disk or another
 *  machine's (`runner/volumes.ts`). */
const CASES = [
  { runner: "r-local", name: "local", dockerHost: null, session: "s-local", task: "t-local" },
  {
    runner: "r-remote",
    name: "mini-atelier",
    dockerHost: "ssh://operator@mini-atelier",
    session: "s-remote",
    task: "t-remote",
  },
] as const;

const now = new Date();
db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({
    id: AGENT,
    projectId: PROJECT,
    name: "build",
    rolePrompt: "r",
    createdAt: now,
  })
  .run();
for (const c of CASES) {
  db.insert(schema.runners)
    .values({
      id: c.runner,
      name: c.name,
      kind: RUNNER_KIND.docker,
      dockerHost: c.dockerHost,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: c.task,
      projectId: PROJECT,
      name: `task ${c.name}`,
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: c.session,
      taskId: c.task,
      agentId: AGENT,
      runnerId: c.runner,
      model: "sonnet",
      status: "running",
      callbackToken: `tok-${c.runner}`,
      startedAt: now,
    })
    .run();
}

/** The write as the payload does it: `pr.md` RELATIVE, as the brief asks. The relative path
 *  resolves to the session's artifacts folder, never to the agent's personal folder (bug of 23/08,
 *  see `projects/fs-acl.ts`). */
const writeDraft = (c: (typeof CASES)[number]) =>
  app.request(`/internal/sessions/${c.session}/fs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer tok-${c.runner}` },
    body: JSON.stringify({ op: "write", path: "pr.md", content: `# ${c.name}\n` }),
  });

describe("artifacts land on the control plane's disk, wherever the session runs", () => {
  it("a session on an ssh:// runner writes where `taskArtifactsDir` reads, like a local session", async () => {
    for (const c of CASES) {
      const res = await writeDraft(c);
      assert.equal(res.status, 200, `write refused for ${c.name}: ${await res.text()}`);
    }

    for (const c of CASES) {
      const found = taskArtifactsDir(c.task);
      assert.ok(found, `no artifacts folder for ${c.task}`);
      const file = join(found.dir, "pr.md");
      assert.ok(existsSync(file), `pr.md missing from ${file}`);
      // The CONTENT, not only existence: a folder created empty by a docker mount looks a lot like an
      // artifacts folder that was used.
      assert.equal(readFileSync(file, "utf8"), `# ${c.name}\n`);
    }
  });

  it("the folder is the project's on THIS machine: no remote host path enters it", () => {
    const local = taskArtifactsDir("t-local")!.dir;
    const remote = taskArtifactsDir("t-remote")!.dir;
    // Two sibling folders under the project root: the runner's `docker_host` appears in neither,
    // and there is no third place to look.
    assert.equal(dirname(local), dirname(remote));
    assert.ok(remote.startsWith(resolve(dir)), `${remote} is not under ${dir}`);
  });
});
