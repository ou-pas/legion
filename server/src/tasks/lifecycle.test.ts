// The original bug was a `where` clause too narrow: it silently did nothing for three statuses out
// of four. The worst failure mode: no error, no trace, just a board telling the opposite of what
// happens.
//
// These tests therefore walk every starting status, one by one. A test checking only the normal
// case (`todo`) already passed before the fix.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-lifecycle-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  markTaskStarted,
  applyTaskTransition,
  TASK_MOVE,
  SETTLED,
  LAUNCHABLE_STATUSES,
  EDITABLE_STATUSES,
  TASK_STATUSES,
  isTaskEditable,
  isBriefEditable,
  taskBranch,
} = await import("./lifecycle.js");
const { isConventionalBranch } = await import("./task-branch.js");
const { applyTaskEdit } = await import("./task-edit.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { BRANCH_TYPE } = await import("./task-branch.js");

const PROJECT = "p1";
const AGENT = "a1";

function seedFixtures() {
  const now = new Date();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "T", slug: "t", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
}

function makeTask(status: TaskStatus, queued = false) {
  const now = new Date();
  const id = `t-${status}-${queued ? "q" : "n"}`;
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: id,
      status,
      queued,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

const statusOf = (id: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

describe("markTaskStarted", () => {
  beforeEach(() => seedFixtures());

  for (const from of LAUNCHABLE_STATUSES) {
    it(`${from} becomes doing: a starting session means the task is taken`, () => {
      const id = makeTask(from);
      assert.equal(markTaskStarted(id), true, "a row must move");
      assert.equal(statusOf(id)?.status, TASK_STATUS.doing);
    });
  }

  it("later does not stay in its column: the bug being fixed", () => {
    // The board promises "no agent will take it" on this column. A task staying there with a live
    // session breaks that promise.
    const id = makeTask(TASK_STATUS.later);
    markTaskStarted(id);
    assert.notEqual(statusOf(id)?.status, TASK_STATUS.later);
  });

  it("done does not move, and says so", () => {
    const id = makeTask(TASK_STATUS.done);
    assert.equal(markTaskStarted(id), false, "no row may move");
    assert.equal(statusOf(id)?.status, TASK_STATUS.done);
  });

  it("a missing task returns false rather than throwing", () => {
    assert.equal(markTaskStarted("does-not-exist"), false);
  });

  it("clears `queued`: a starting session proves a slot was found", () => {
    const id = makeTask(TASK_STATUS.todo, true);
    markTaskStarted(id);
    assert.equal(statusOf(id)?.queued, false);
  });

  it("does not clear `queued` on a task it refuses to touch", () => {
    const id = makeTask(TASK_STATUS.done, true);
    markTaskStarted(id);
    assert.equal(statusOf(id)?.queued, true, "refusing must be total, not partial");
  });
});

// The table itself. Each row is already exercised by the caller citing it (task-settle,
// stalled-start, internal-routes, slices…); this block tests what none of those paths do: the
// shared writer, and the two ways to fool it.
describe("applyTaskTransition", () => {
  beforeEach(() => seedFixtures());

  it("honours the transition's `from`: outside the list, nothing moves", () => {
    const id = makeTask(TASK_STATUS.todo);
    assert.equal(
      applyTaskTransition(id, TASK_MOVE.settle),
      false,
      "`settle` only starts from `doing`",
    );
    assert.equal(statusOf(id)?.status, TASK_STATUS.todo);
  });

  it("writes the transition's `also` in the same update as the status", () => {
    const id = makeTask(TASK_STATUS.doing);
    assert.equal(applyTaskTransition(id, TASK_MOVE.stop), true);
    const row = statusOf(id);
    assert.equal(row?.status, TASK_STATUS.review);
    assert.equal(
      row?.settledOutcome,
      SETTLED.stopped,
      "the notice goes with the settlement, not after",
    );
  });

  it("`from: null` is not a forgotten filter: the transition starts from anywhere", () => {
    const id = makeTask(TASK_STATUS.done);
    assert.equal(applyTaskTransition(id, TASK_MOVE.reopen, { description: "amended" }), true);
    assert.equal(statusOf(id)?.status, TASK_STATUS.todo);
    assert.equal(statusOf(id)?.description, "amended");
  });

  it("`extra` cannot hijack the target: the table decides the status", () => {
    const id = makeTask(TASK_STATUS.doing);
    // @ts-expect-error `status` is not in `TaskStatusWrite`: the guard is first a type
    applyTaskTransition(id, TASK_MOVE.settle, { status: TASK_STATUS.done });
    assert.equal(statusOf(id)?.status, TASK_STATUS.review, "and the runtime says the same");
  });
});

// Same lesson as markTaskStarted: loop over every status, not just the normal case. A test checking
// only `later` would let the same bug through on `todo`.
describe("isTaskEditable", () => {
  for (const status of TASK_STATUSES) {
    const expected = (EDITABLE_STATUSES as readonly string[]).includes(status);
    it(`${status}, no live session, not demo → ${expected}`, () => {
      assert.equal(
        isTaskEditable({ status }, { hasLiveSession: false, demoProject: false }),
        expected,
      );
    });
  }

  it("later with a live session → false", () => {
    assert.equal(
      isTaskEditable({ status: TASK_STATUS.later }, { hasLiveSession: true, demoProject: false }),
      false,
    );
  });

  it("todo with a live session → false", () => {
    assert.equal(
      isTaskEditable({ status: TASK_STATUS.todo }, { hasLiveSession: true, demoProject: false }),
      false,
    );
  });

  for (const status of TASK_STATUSES) {
    it(`demo project, ${status} → false whatever the status`, () => {
      assert.equal(isTaskEditable({ status }, { hasLiveSession: false, demoProject: true }), false);
    });
  }

  it("EDITABLE_STATUSES is a strict subset of LAUNCHABLE_STATUSES: anything editable can be launched", () => {
    for (const s of EDITABLE_STATUSES)
      assert.ok(
        (LAUNCHABLE_STATUSES as readonly string[]).includes(s),
        `"${s}" editable but not launchable`,
      );
    assert.ok(
      LAUNCHABLE_STATUSES.length > EDITABLE_STATUSES.length,
      "the inclusion must be strict",
    );
  });
});

describe("isBriefEditable", () => {
  it("stays true on review/done without a live session: bd8ce68 non-regression", () => {
    assert.equal(isBriefEditable({ hasLiveSession: false }), true);
  });

  it("becomes false as soon as a session is live, whatever the status", () => {
    assert.equal(isBriefEditable({ hasLiveSession: true }), false);
  });
});

// Slice 15's trap, the reason these tests exist: a branch derived from a task's name changes when
// the task is renamed, and already pushed work becomes orphaned without any error. So what is
// checked is less the name's shape (task-branch.test.ts does that, without a database) than its
// stability over time and across a run.
describe("taskBranch", () => {
  const stamp = new Date();
  let n = 0;

  /** A minimal task, with what decides its branch. */
  function branchTask(over: Partial<typeof schema.tasks.$inferInsert> = {}) {
    const id = over.id ?? `b-${++n}`;
    db.insert(schema.tasks)
      .values({
        id,
        projectId: PROJECT,
        name: "Add the button",
        status: TASK_STATUS.todo,
        assigneeAgentId: AGENT,
        createdAt: stamp,
        updatedAt: stamp,
        ...over,
      })
      .run();
    return rowOf(id);
  }

  const rowOf = (id: string) =>
    db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;

  beforeEach(() => {
    seedFixtures();
    n = 0;
  });

  it("derives a conventional branch and stores it: the column was empty, it no longer is", () => {
    const task = branchTask({ type: BRANCH_TYPE.feature });
    assert.equal(task.branch, null, "precondition: nothing stored before the first derivation");
    const branch = taskBranch(task);
    assert.ok(isConventionalBranch(branch), `"${branch}" is not conforming`);
    assert.match(branch, /^feature\/add-the-button-/);
    assert.equal(
      rowOf(task.id).branch,
      branch,
      "the branch must be set in the database, not only returned",
    );
  });

  it("the trap: a rename does not move the branch", () => {
    const task = branchTask({ type: BRANCH_TYPE.feature });
    const before = taskBranch(task);
    const edited = applyTaskEdit(task.id, { name: "A completely different title" });
    assert.equal(edited.ok, true, "precondition: the rename must succeed");
    assert.equal(
      taskBranch(rowOf(task.id)),
      before,
      "otherwise already pushed work becomes orphaned",
    );
  });

  it("is deterministic: two reads of the same task give the same name", () => {
    const task = branchTask({ type: BRANCH_TYPE.bugfix });
    assert.equal(taskBranch(task), taskBranch(rowOf(task.id)));
  });

  it("a task linked to a PR takes that PR's branch, and does not store it", () => {
    const task = branchTask({
      externalRef: JSON.stringify({
        provider: "github",
        issueId: "1",
        identifier: "#1",
        url: "u",
        branch: "renovate/lodash",
      }),
    });
    assert.equal(taskBranch(task), "renovate/lodash");
    assert.equal(rowOf(task.id).branch, null, "someone else's branch is not copied onto the task");
  });

  it("a broken externalRef does not throw: the task falls back to its derivation", () => {
    const task = branchTask({ externalRef: "{not json" });
    assert.ok(isConventionalBranch(taskBranch(task)));
  });

  it("a chain's steps share a branch, despite their different names", () => {
    const a = branchTask({
      name: "Step 1/2 — Spec · the subject",
      templateRunId: "run-9",
      stepIndex: 0,
      type: BRANCH_TYPE.feature,
    });
    const b = branchTask({
      name: "Step 2/2 — Implement · the subject",
      templateRunId: "run-9",
      stepIndex: 1,
      type: BRANCH_TYPE.feature,
    });
    const branch = taskBranch(a);
    assert.equal(
      taskBranch(b),
      branch,
      "two branches for one run, and the artifacts folder no longer tells the truth",
    );
    assert.equal(rowOf(b.id).branch, branch);
  });

  it("a goal task spawned later joins its siblings' branch", () => {
    const first = branchTask({ goalId: "goal-3", type: BRANCH_TYPE.chore });
    const branch = taskBranch(first);
    const later = branchTask({
      name: "One more round",
      goalId: "goal-3",
      type: BRANCH_TYPE.feature,
    });
    assert.equal(taskBranch(later), branch);
  });

  it("a name without a single usable character still gives a valid branch", () => {
    const task = branchTask({ name: "⚠️ ???" });
    const branch = taskBranch(task);
    assert.ok(isConventionalBranch(branch), `"${branch}" is not conforming`);
  });

  it("two distinct tasks do not share a branch, even with the same name", () => {
    const a = branchTask({ name: "The same title" });
    const b = branchTask({ name: "The same title" });
    assert.notEqual(taskBranch(a), taskBranch(b));
  });
});
