// In order:
//
//  1. A paused session keeps its workspace. That is the whole point of D13
//     (/artifacts/rtQLldYSm2/spec.md): `waiting` is exactly when the folder must hold, since the
//     container was destroyed. A sweep taking it would make the lot useless and lose unpushed work.
//  2. Disk IS given back: task `done`, task deleted, terminal session, unknown session.
//  3. The error's direction: an UNKNOWN session status is kept, not erased. Keeping one folder too
//     many costs disk; deleting one too many costs a session.
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

// `db.ts` reads LEGION_DB on import, `workspace.ts` reads LEGION_DATA: both before the import.
const root = mkdtempSync(join(tmpdir(), "legion-workspace-"));
process.env.LEGION_DB = join(root, "test.db");
process.env.LEGION_DATA = join(root, "data");
after(() => rmSync(root, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const {
  PACKAGE_CACHE_DIR,
  ensureMountDirs,
  releaseWorkspace,
  releaseWorkspacesOfTask,
  sweepOrphanWorkspaces,
  workspaceDir,
  workspacesOnDisk,
  workspacesToRelease,
} = await import("./workspace.js");
const { SESSION_STATUS } = await import("../session-terminal.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const owner = (id: string, status: string, taskStatus: string | null) => ({
  id,
  status,
  taskStatus,
});

describe("workspacesToRelease: the rule, without disk or docker", () => {
  it("KEEPS a paused session's workspace: the lot's reason to exist", () => {
    assert.deepEqual(
      workspacesToRelease(["s1"], [owner("s1", SESSION_STATUS.waiting, TASK_STATUS.doing)]),
      [],
    );
  });

  it("also keeps sessions running, starting or committing", () => {
    const owners = ["starting", "running", "committing"].map((s, i) =>
      owner(`s${i}`, s, TASK_STATUS.doing),
    );
    assert.deepEqual(
      workspacesToRelease(
        owners.map((o) => o.id),
        owners,
      ),
      [],
    );
  });

  it("releases on a done task, even if the session is still paused", () => {
    assert.deepEqual(
      workspacesToRelease(["s1"], [owner("s1", SESSION_STATUS.waiting, TASK_STATUS.done)]),
      ["s1"],
    );
  });

  it("releases a terminal session: it will never resume", () => {
    const owners = [
      owner("s1", "destroyed", TASK_STATUS.doing),
      owner("s2", "failed", TASK_STATUS.review),
    ];
    assert.deepEqual(workspacesToRelease(["s1", "s2"], owners), ["s1", "s2"]);
  });

  it("releases a folder whose session no longer exists (task deleted)", () => {
    assert.deepEqual(workspacesToRelease(["ghost"], []), ["ghost"]);
  });

  it("an UNKNOWN status is kept: the error's direction is chosen", () => {
    // The hard-coded list is the DEAD states (`TERMINAL`), so a status added tomorrow is kept
    // (extra disk), never erased (one session fewer).
    assert.deepEqual(
      workspacesToRelease(["s1"], [owner("s1", "hibernating", TASK_STATUS.doing)]),
      [],
    );
  });
});

describe("workspace: the folders, for real", () => {
  type TaskStatus = (typeof schema.tasks.$inferInsert)["status"];
  type SessionStatus = (typeof schema.sessions.$inferInsert)["status"];

  const makeSession = (id: string, status: SessionStatus, taskStatus: TaskStatus) => {
    const projectId = `p-${id}`;
    const taskId = `t-${id}`;
    db.insert(schema.projects)
      .values({ id: projectId, name: id, slug: id, createdAt: new Date() })
      .run();
    db.insert(schema.agents)
      .values({
        id: `a-${id}`,
        projectId,
        name: `agent-${id}`,
        rolePrompt: "r",
        fsGrants: "[]",
        createdAt: new Date(),
      })
      .run();
    db.insert(schema.tasks)
      .values({
        id: taskId,
        projectId,
        name: id,
        status: taskStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    db.insert(schema.runners)
      .values({ id: `r-${id}`, name: id, kind: RUNNER_KIND.process })
      .run();
    db.insert(schema.sessions)
      .values({
        id,
        taskId,
        agentId: `a-${id}`,
        runnerId: `r-${id}`,
        model: "m",
        status,
        callbackToken: "tok",
        startedAt: new Date(),
      })
      .run();
    fs.mkdirSync(join(workspaceDir(id), "repos", "x"), { recursive: true });
    fs.writeFileSync(join(workspaceDir(id), "repos", "x", "node_modules.marker"), "640 MB");
    return taskId;
  };

  it("ensureMountDirs creates both mounts: workspace and both halves of the cache", () => {
    const dir = join(root, "mounts", "workspace");
    ensureMountDirs({ workspaceDir: dir, packageCacheDir: PACKAGE_CACHE_DIR });
    assert.ok(fs.existsSync(dir));
    // The NAMES are the contract with session-image/Dockerfile: `pnpm-store` is the target of the
    // link on the default store, `npm` the value of `npm_config_cache`. A diverging name makes the
    // cache SILENT: the session works, it just downloads everything again, saying nothing.
    assert.ok(fs.existsSync(join(PACKAGE_CACHE_DIR, "pnpm-store")));
    assert.ok(fs.existsSync(join(PACKAGE_CACHE_DIR, "npm")));
    const dockerfile = fs.readFileSync(
      new URL("../../../../session-image/Dockerfile", import.meta.url),
      "utf8",
    );
    assert.match(dockerfile, /ln -s \/pkg-cache\/pnpm-store /);
    assert.match(dockerfile, /npm_config_cache=\/pkg-cache\/npm/);
  });

  it("the package cache is a SIBLING of the workspaces, not elsewhere", () => {
    // D14: both live under LEGION_DATA. A cache outside the data folder would be invisible to
    // backup and cleanup, and nobody would know.
    assert.equal(PACKAGE_CACHE_DIR.startsWith(join(root, "data")), true);
  });

  it("releaseWorkspacesOfTask removes the folder of each of the task's sessions", () => {
    const taskId = makeSession("w-done", "destroyed", TASK_STATUS.done);
    assert.equal(fs.existsSync(workspaceDir("w-done")), true);
    assert.equal(releaseWorkspacesOfTask(taskId), 1);
    assert.equal(fs.existsSync(workspaceDir("w-done")), false);
    // Idempotent: called again (done then deletion), it does not count twice.
    assert.equal(releaseWorkspacesOfTask(taskId), 0);
  });

  it("releaseWorkspace on a missing folder does not throw and returns false", () => {
    assert.equal(releaseWorkspace("never-seen"), false);
  });

  it("the sweep releases the dead and SPARES the paused session", () => {
    makeSession("w-pause", SESSION_STATUS.waiting, TASK_STATUS.doing);
    makeSession("w-dead", "failed", TASK_STATUS.doing);
    fs.mkdirSync(workspaceDir("w-ghost"), { recursive: true }); // no database row

    const before = workspacesOnDisk().sort();
    assert.deepEqual(before, ["w-dead", "w-ghost", "w-pause"]);

    const swept = sweepOrphanWorkspaces();

    assert.deepEqual(swept, { released: 2, kept: 1 });
    assert.equal(fs.existsSync(workspaceDir("w-pause")), true, "the pause keeps its work");
    assert.equal(fs.existsSync(workspaceDir("w-dead")), false);
    assert.equal(fs.existsSync(workspaceDir("w-ghost")), false);
  });

  // The 30/08 defect, measured on a real session. The agent writes its file, calls `update_task`
  // with `done` (as the brief asks) and `onTaskDone` removed the workspace from under a STILL
  // LIVING session. Its final push failed on `spawn git ENOENT`, the session ended with code 0,
  // the task went `done`, and NOTHING was pushed.
  //
  // It only showed on "write access + done from the session", i.e. exactly the nominal case.
  //
  // These three cases come AFTER the sweep on purpose: they leave folders on disk, and the sweep
  // test asserts on the full list of what is there.
  it("KEEPS a still-living session's workspace, even if the task goes done", () => {
    const taskId = makeSession("w-alive", "running", TASK_STATUS.done);
    assert.equal(releaseWorkspacesOfTask(taskId), 0, "a running session still has its push to do");
    assert.equal(fs.existsSync(workspaceDir("w-alive")), true);
  });

  it('the five living statuses are protected, not only "running"', () => {
    for (const status of [
      "starting",
      "running",
      SESSION_STATUS.waiting,
      "blocked",
      "committing",
    ] as const) {
      const taskId = makeSession(`w-${status}`, status, TASK_STATUS.done);
      assert.equal(releaseWorkspacesOfTask(taskId), 0, status);
      assert.equal(fs.existsSync(workspaceDir(`w-${status}`)), true, status);
    }
  });

  it("but it does remove a finished session's workspace of the same task", () => {
    // The filter works session by session: a relaunched task has several, and releasing the dead
    // ones stays the intended behaviour.
    const taskId = makeSession("w-ended", "destroyed", TASK_STATUS.done);
    assert.equal(releaseWorkspacesOfTask(taskId), 1);
    assert.equal(fs.existsSync(workspaceDir("w-ended")), false);
  });
});
