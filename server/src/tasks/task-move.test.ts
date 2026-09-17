// What this file protects:
//
//  1. cross-column drag and drop changes the moved task's `status`;
//  2. same-column drag and drop (reorder) only touches the rank, never the status;
//  3. the normal case (insert between two placed siblings) rewrites only the moved task; no other
//     row, even in the target column, may move;
//  4. after a long run of inserts at the same spot, float precision runs out and a fallback
//     (integer resequencing) kicks in, never producing a duplicate rank or an inconsistent gap, and
//     bounded to the affected column;
//  5. refusals are named (404 missing task, 400 invalid status/index, 400 forbidden later
//     transition), never a silent success on invalid input.
//
// Real temporary SQLite, like task-edit.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-task-move-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { applyTaskMove, BOARD_ORDER_GAP } = await import("./task-move.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P1 = "p1";
const A1 = "a1";
const RUNNER = "r1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

/** Creates a task with an explicit rank (the schema default, 0, would stack every test task on one
 *  rank; tests set spaced ranks on purpose to simulate a populated board). */
function makeTask(status: TaskStatus, boardOrder: number, projectId = P1): string {
  const now = new Date();
  const id = `t-${status}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.tasks)
    .values({
      id,
      projectId,
      name: "title",
      status,
      assigneeAgentId: A1,
      boardOrder,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const columnOf = (projectId: string, status: TaskStatus) =>
  db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.status, status)))
    .all()
    .sort((a, b) => a.boardOrder - b.boardOrder);

describe("applyTaskMove", () => {
  beforeEach(() => reset());

  it("drop into an empty column → rank = BOARD_ORDER_GAP, status set", () => {
    const id = makeTask(TASK_STATUS.todo, 100);
    const r = applyTaskMove(id, { status: TASK_STATUS.doing, index: 0 });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.status, TASK_STATUS.doing);
    assert.equal(r.ok && r.task.boardOrder, BOARD_ORDER_GAP);
    assert.equal(r.ok && r.rebalanced, false);
  });

  it("cross-column: the status changes, the source column loses the task, the target gains it", () => {
    const id = makeTask(TASK_STATUS.todo, 100);
    makeTask(TASK_STATUS.doing, 100); // a sibling in the target column, to avoid the empty-column case
    const r = applyTaskMove(id, { status: TASK_STATUS.doing, index: 1 });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.status, TASK_STATUS.doing);
    assert.equal(columnOf(P1, TASK_STATUS.todo).length, 0);
    assert.equal(columnOf(P1, TASK_STATUS.doing).length, 2);
  });

  it("insert between two siblings → rank = their exact average, no other row moves", () => {
    const a = makeTask(TASK_STATUS.todo, 100);
    const b = makeTask(TASK_STATUS.todo, 200);
    const moved = makeTask(TASK_STATUS.doing, 500); // comes from elsewhere
    const beforeA = taskRow(a)!,
      beforeB = taskRow(b)!;
    const r = applyTaskMove(moved, { status: TASK_STATUS.todo, index: 1 }); // between a (index 0) and b (index 1)
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.boardOrder, 150);
    assert.equal(r.ok && r.rebalanced, false);
    // a and b: rank and updatedAt unchanged; only the moved task was rewritten.
    assert.deepEqual(taskRow(a), beforeA);
    assert.deepEqual(taskRow(b), beforeB);
    assert.deepEqual(
      columnOf(P1, TASK_STATUS.todo).map((t) => t.id),
      [a, moved, b],
    );
  });

  it("drop at the top of the column → rank = sibling - GAP", () => {
    const a = makeTask(TASK_STATUS.todo, 100);
    const moved = makeTask(TASK_STATUS.doing, 500);
    const r = applyTaskMove(moved, { status: TASK_STATUS.todo, index: 0 });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.boardOrder, 100 - BOARD_ORDER_GAP);
    assert.deepEqual(
      columnOf(P1, TASK_STATUS.todo).map((t) => t.id),
      [moved, a],
    );
  });

  it("drop at the bottom of the column → rank = sibling + GAP", () => {
    const a = makeTask(TASK_STATUS.todo, 100);
    const moved = makeTask(TASK_STATUS.doing, 500);
    const r = applyTaskMove(moved, { status: TASK_STATUS.todo, index: 1 });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.boardOrder, 100 + BOARD_ORDER_GAP);
    assert.deepEqual(
      columnOf(P1, TASK_STATUS.todo).map((t) => t.id),
      [a, moved],
    );
  });

  it("index past the column → bounded, dropped at the bottom rather than refused", () => {
    const a = makeTask(TASK_STATUS.todo, 100);
    const moved = makeTask(TASK_STATUS.doing, 500);
    const r = applyTaskMove(moved, { status: TASK_STATUS.todo, index: 999 });
    assert.ok(r.ok);
    assert.deepEqual(
      columnOf(P1, TASK_STATUS.todo).map((t) => t.id),
      [a, moved],
    );
  });

  it("same-column reorder: the status does not change, only the rank moves", () => {
    const a = makeTask(TASK_STATUS.todo, 100);
    const b = makeTask(TASK_STATUS.todo, 200);
    const c = makeTask(TASK_STATUS.todo, 300);
    const before = taskRow(c)!;
    // c moves to the top of its own column
    const r = applyTaskMove(c, { status: TASK_STATUS.todo, index: 0 });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.status, TASK_STATUS.todo);
    assert.notEqual(taskRow(c)!.boardOrder, before.boardOrder);
    assert.deepEqual(
      columnOf(P1, TASK_STATUS.todo).map((t) => t.id),
      [c, a, b],
    );
  });

  it("repeated inserts at the same spot exhaust float precision → local integer resequencing fallback, never a duplicate or disorder", () => {
    const a = makeTask(TASK_STATUS.todo, 0);
    const b = makeTask(TASK_STATUS.todo, BOARD_ORDER_GAP);
    const inserted: string[] = [];
    let sawRebalance = false;
    for (let i = 0; i < 60; i++) {
      const id = makeTask(TASK_STATUS.doing, 9999); // always created elsewhere, then moved
      const r = applyTaskMove(id, { status: TASK_STATUS.todo, index: 1 }); // always between a and the last inserted
      assert.ok(r.ok, `move #${i} must succeed`);
      if (r.ok && r.rebalanced) sawRebalance = true;
      inserted.push(id);
    }
    assert.ok(sawRebalance, "60 inserts at the same spot must end up triggering a fallback");

    const col = columnOf(P1, TASK_STATUS.todo);
    // No inconsistent gap (strictly increasing total order) and no duplicate rank.
    const orders = col.map((t) => t.boardOrder);
    for (let i = 1; i < orders.length; i++)
      assert.ok(orders[i]! > orders[i - 1]!, `rank #${i} must be strictly increasing`);
    assert.equal(new Set(orders).size, orders.length, "no duplicate rank");
    // a first, b last. Each insert targets "right after a" (index 1): the most recent one ends up
    // closest to a, and the column holds the reverse drop order between the two bounds.
    assert.equal(col[0]!.id, a);
    assert.equal(col.at(-1)!.id, b);
    assert.deepEqual(
      col.slice(1, -1).map((t) => t.id),
      [...inserted].reverse(),
    );

    // The fallback only touched the todo column: the doing column (emptied by the successive moves)
    // has no row left, nothing lingers there.
    assert.equal(columnOf(P1, TASK_STATUS.doing).length, 0);
  });

  it("fallback triggered by two nearly merged siblings: column sorted without duplicate afterwards", () => {
    const a = makeTask(TASK_STATUS.todo, BOARD_ORDER_GAP);
    const tight = makeTask(TASK_STATUS.todo, BOARD_ORDER_GAP + 1e-9); // gap < MIN_GAP → guaranteed fallback
    const b = makeTask(TASK_STATUS.todo, 2 * BOARD_ORDER_GAP);
    const moved = makeTask(TASK_STATUS.doing, 0);
    const r = applyTaskMove(moved, { status: TASK_STATUS.todo, index: 1 }); // between a and tight → fallback
    assert.ok(r.ok && r.rebalanced);
    const col = columnOf(P1, TASK_STATUS.todo);
    assert.deepEqual(
      col.map((t) => t.id),
      [a, moved, tight, b],
    );
    const orders = col.map((t) => t.boardOrder);
    assert.equal(new Set(orders).size, orders.length, "no duplicate rank after the fallback");
    for (let i = 1; i < orders.length; i++) assert.ok(orders[i]! > orders[i - 1]!);
  });

  it("missing task → 404", () => {
    const r = applyTaskMove("does-not-exist", { status: TASK_STATUS.todo, index: 0 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 404);
  });

  it("status outside the enum → 400", () => {
    const id = makeTask(TASK_STATUS.todo, 0);
    const r = applyTaskMove(id, { status: "bogus", index: 0 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("negative or non-integer index → 400", () => {
    const id = makeTask(TASK_STATUS.todo, 0);
    for (const bad of [-1, 1.5, NaN]) {
      const r = applyTaskMove(id, { status: TASK_STATUS.todo, index: bad });
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.status, 400);
    }
  });

  it("doing dropped into later → 400, the message names the original status (same rule as PATCH)", () => {
    const id = makeTask(TASK_STATUS.doing, 0);
    const r = applyTaskMove(id, { status: TASK_STATUS.later, index: 0 });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes(TASK_STATUS.doing));
    assert.equal(taskRow(id)!.status, TASK_STATUS.doing, "no row may have moved");
  });

  it("later dropped straight into review → 400 (must go through todo first)", () => {
    const id = makeTask(TASK_STATUS.later, 0);
    const r = applyTaskMove(id, { status: TASK_STATUS.review, index: 0 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
    assert.equal(taskRow(id)!.status, TASK_STATUS.later);
  });

  it("later dropped into todo → ok (allowed transition)", () => {
    const id = makeTask(TASK_STATUS.later, 0);
    const r = applyTaskMove(id, { status: TASK_STATUS.todo, index: 0 });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.status, TASK_STATUS.todo);
  });

  it("done reached through a move triggers onTaskDone without throwing (no chain here → silent no-op)", () => {
    const id = makeTask(TASK_STATUS.review, 0);
    assert.doesNotThrow(() => applyTaskMove(id, { status: TASK_STATUS.done, index: 0 }));
  });

  it("the columns of two different projects never influence each other", () => {
    const P2 = "p2";
    db.insert(schema.projects)
      .values({ id: P2, name: "P2", slug: "p2", createdAt: new Date() })
      .run();
    db.insert(schema.agents)
      .values({ id: "a2", projectId: P2, name: "a2", rolePrompt: "r", createdAt: new Date() })
      .run();
    makeTask(TASK_STATUS.todo, 100, P2); // same todo column, other project
    const id = makeTask(TASK_STATUS.doing, 0, P1);
    const r = applyTaskMove(id, { status: TASK_STATUS.todo, index: 0 });
    assert.ok(r.ok);
    assert.equal(columnOf(P1, TASK_STATUS.todo).length, 1);
    assert.equal(columnOf(P2, TASK_STATUS.todo).length, 1, "project 2 must not have moved");
  });
});
