// The task to edit, and the transaction setting its blockers, nothing if a session started in the
// meantime (10/09: the race closed here is a launch, no longer a status change; see
// `task-blocker-edit-store.ts`). Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-blocker-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { applyBlockerChanges, findTaskRow } = await import("./task-blocker-edit-store.js");
const { blockersOf } = await import("./blockers-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { ACTIVE_STATUSES } = await import("../sessions/session-terminal.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: P, name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: RUNNER_KIND.process }).run();
db.insert(schema.tasks)
  .values([
    {
      id: "editable",
      projectId: P,
      name: "pending",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
    // A `review` task is still editable while no session runs (10/09): status alone no longer
    // closes the race.
    {
      id: "review-idle",
      projectId: P,
      name: "in review, no session",
      status: TASK_STATUS.review,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "live",
      projectId: P,
      name: "live session",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "b1",
      projectId: P,
      name: "blocker 1",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "b2",
      projectId: P,
      name: "blocker 2",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.sessions)
  .values({
    id: "s-live",
    taskId: "live",
    agentId: "a1",
    runnerId: "r1",
    model: "sonnet",
    status: "running",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();

describe("findTaskRow", () => {
  it("returns the row, or undefined", () => {
    assert.equal(findTaskRow("editable")?.name, "pending");
    assert.equal(findTaskRow("never-seen"), undefined);
  });
});

describe("applyBlockerChanges", () => {
  it("adds and removes blockers on a task without a live session", () => {
    const ok = applyBlockerChanges("editable", ["b1", "b2"], [], ACTIVE_STATUSES);
    assert.equal(ok, true);
    assert.deepEqual(blockersOf("editable").sort(), ["b1", "b2"]);

    const ok2 = applyBlockerChanges("editable", [], ["b1"], ACTIVE_STATUSES);
    assert.equal(ok2, true);
    assert.deepEqual(blockersOf("editable"), ["b2"]);
  });

  it("a `review` task stays editable while no session runs", () => {
    const ok = applyBlockerChanges("review-idle", ["b1"], [], ACTIVE_STATUSES);
    assert.equal(ok, true);
    assert.deepEqual(blockersOf("review-idle"), ["b1"]);
  });

  it("refuses (returns false, writes nothing) if a session in `liveStatuses` runs", () => {
    const ok = applyBlockerChanges("live", ["b1"], [], ACTIVE_STATUSES);
    assert.equal(ok, false);
    assert.deepEqual(blockersOf("live"), []);
  });

  it("hard-codes no list: a `running` session outside `liveStatuses` blocks nothing", () => {
    const ok = applyBlockerChanges("live", ["b1"], [], ["waiting"]);
    assert.equal(ok, true, "the caller alone decides what counts as in flight");
    assert.deepEqual(blockersOf("live"), ["b1"]);
  });

  it("returns `false` for a task that does not exist", () => {
    assert.equal(applyBlockerChanges("never-seen", ["b1"], [], ACTIVE_STATUSES), false);
  });
});
