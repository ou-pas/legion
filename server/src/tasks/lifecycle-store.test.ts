// The only writer of a task's status, the session lookups automatic settlement needs, and its
// control-plane trace. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-lifecycle-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema, listControlEvents } = await import("../shared/db.js");
const {
  archiveDoneTaskRows,
  hasActiveSession,
  lastSessionOf,
  logAutomaticSettlementEvent,
  persistBranchIfUnset,
  pushOrFsOpEvents,
  sessionIdsOf,
  siblingBranchOf,
  writeTaskStatus,
} = await import("./lifecycle-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { FS_OP_EVENT, REPO_PUSH_EVENT } = await import("../shared/events.js");

const P = "p1";
const now = new Date();

db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: P, name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: "process" }).run();
db.insert(schema.tasks)
  .values([
    {
      id: "t1",
      projectId: P,
      name: "in progress",
      status: TASK_STATUS.doing,
      templateRunId: "run1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t2",
      projectId: P,
      name: "sibling",
      status: TASK_STATUS.todo,
      templateRunId: "run1",
      branch: "chore/already-set",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t3",
      projectId: P,
      name: "to archive",
      status: TASK_STATUS.done,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t4",
      projectId: P,
      name: "already archived",
      status: TASK_STATUS.done,
      archived: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t5",
      projectId: P,
      name: "for writeTaskStatus",
      status: TASK_STATUS.done,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.sessions)
  .values([
    {
      id: "s-old",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "sonnet",
      status: "destroyed",
      callbackToken: "tok",
      startedAt: new Date(now.getTime() - 1000),
    },
    {
      id: "s-new",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: now,
    },
  ])
  .run();
db.insert(schema.sessionEvents)
  .values([
    { sessionId: "s-new", type: REPO_PUSH_EVENT, payload: "{}", createdAt: now },
    { sessionId: "s-new", type: FS_OP_EVENT, payload: "{}", createdAt: now },
    { sessionId: "s-new", type: "other", payload: "{}", createdAt: now },
  ])
  .run();

describe("writeTaskStatus", () => {
  it("writes the status and returns `true` when a row moved", () => {
    const ok = writeTaskStatus("t5", { status: TASK_STATUS.review, updatedAt: now }, [
      TASK_STATUS.done,
    ]);
    assert.equal(ok, true);
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "t5")?.status,
      TASK_STATUS.review,
    );
  });

  it("returns `false` when the required status no longer matches (lost race)", () => {
    const ok = writeTaskStatus("t5", { status: TASK_STATUS.done, updatedAt: now }, [
      TASK_STATUS.doing,
    ]);
    assert.equal(ok, false);
  });
});

describe("siblingBranchOf", () => {
  it("returns the branch already set by a sibling of the same run", () => {
    assert.equal(siblingBranchOf("run1"), "chore/already-set");
    assert.equal(siblingBranchOf("unknown-run"), null);
  });
});

describe("persistBranchIfUnset", () => {
  it("sets the branch only if not already set", () => {
    persistBranchIfUnset("t1", "feature/new");
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "t1")?.branch,
      "feature/new",
    );
    persistBranchIfUnset("t1", "feature/other");
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "t1")?.branch,
      "feature/new",
      "the first wins",
    );
  });
});

describe("hasActiveSession / lastSessionOf / sessionIdsOf", () => {
  it("detects an active session, returns the latest, and all ids", () => {
    assert.equal(hasActiveSession("t1"), true);
    assert.equal(hasActiveSession("t3"), false);
    assert.equal(lastSessionOf("t1")?.id, "s-new");
    assert.deepEqual(sessionIdsOf("t1").sort(), ["s-new", "s-old"]);
  });
});

describe("pushOrFsOpEvents", () => {
  it("returns only repo_push/fs_op events, nothing for an empty list", () => {
    const events = pushOrFsOpEvents(["s-new"]);
    assert.deepEqual(events.map((e) => e.type).sort(), [FS_OP_EVENT, REPO_PUSH_EVENT].sort());
    assert.deepEqual(pushOrFsOpEvents([]), []);
  });
});

describe("logAutomaticSettlementEvent", () => {
  it("traces the event as warn, under the task-settle domain", () => {
    logAutomaticSettlementEvent("t1", "settled automatically", {
      outcome: "delivered",
      sessionId: "s-new",
      endReason: null,
    });
    const [last] = listControlEvents({ limit: 1 });
    assert.equal(last?.source, "task-settle");
    assert.equal(last?.level, "warn");
  });
});

describe("archiveDoneTaskRows", () => {
  it("archives the project's unarchived `done` tasks, returns the count, zero included", () => {
    const n = archiveDoneTaskRows(P, TASK_STATUS.done);
    assert.equal(n, 1, "only t3 was done and unarchived");
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "t3")?.archived,
      true,
    );
    assert.equal(archiveDoneTaskRows(P, TASK_STATUS.done), 0, "nothing more to archive");
  });
});
