// The fresh read of the target column, and the transaction writing what `decidePlacement` decides
// and triggering what `onWritten` decides. The rank policy (float average, integer fallback) and
// triggering `settleDone` on `done` are tested in `task-move.test.ts` (`applyTaskMove`, the real
// caller); here `move()` replays the same real functions to check the store wires them correctly
// (fresh read, writing what they decide), not a policy of its own. Real temporary SQLite, like its
// domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-task-move-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { findTaskRow, moveWithinColumn } = await import("./task-move-store.js");
const { decidePlacement } = await import("./task-move.js");
const { settleDone } = await import("../chains/templates.js");
const { addBlocker, blockersOf } = await import("./blockers-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const GAP = 1024;

function move(
  taskId: string,
  status: (typeof TASK_STATUS)[keyof typeof TASK_STATUS],
  index: number,
  gap = GAP,
) {
  return moveWithinColumn(taskId, status, { index, gap, decide: decidePlacement }, (current) =>
    status === TASK_STATUS.done && current.status !== TASK_STATUS.done ? settleDone(taskId) : null,
  );
}
const now = new Date();

function reset() {
  db.delete(schema.taskBlockers).run();
  db.delete(schema.tasks).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
  db.insert(schema.tasks)
    .values([
      {
        id: "a",
        projectId: P,
        name: "A",
        status: TASK_STATUS.todo,
        boardOrder: GAP,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "b",
        projectId: P,
        name: "B",
        status: TASK_STATUS.todo,
        boardOrder: GAP * 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "moved",
        projectId: P,
        name: "M",
        status: TASK_STATUS.doing,
        boardOrder: GAP,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "d1",
        projectId: P,
        name: "D1",
        status: TASK_STATUS.done,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
}

describe("findTaskRow", () => {
  beforeEach(() => reset());

  it("returns the row, or undefined", () => {
    assert.equal(findTaskRow("a")?.name, "A");
    assert.equal(findTaskRow("never-seen"), undefined);
  });
});

describe("moveWithinColumn", () => {
  beforeEach(() => reset());

  it("returns `found: false` for a vanished task", () => {
    assert.deepEqual(move("never-seen", TASK_STATUS.todo, 0, GAP), { found: false });
  });

  it("places at the top of the column (before the first), without rebalance", () => {
    const w = move("moved", TASK_STATUS.todo, 0, GAP);
    assert.ok(w.found);
    assert.equal(w.rebalanced, false);
    assert.equal(w.task.boardOrder < GAP, true, "before the first (rank GAP)");
    assert.equal(w.task.status, TASK_STATUS.todo);
  });

  it("places at the bottom of the column (after the last)", () => {
    const w = move("moved", TASK_STATUS.todo, 2, GAP);
    assert.ok(w.found);
    assert.equal(w.task.boardOrder > GAP * 2, true, "after the last (rank 2*GAP)");
  });

  it("places between two siblings by float average", () => {
    const w = move("moved", TASK_STATUS.todo, 1, GAP);
    assert.ok(w.found);
    assert.equal(w.rebalanced, false);
    assert.equal(w.task.boardOrder, (GAP + GAP * 2) / 2);
  });

  it("consumes blockers and releases tasks when the drop reaches done", () => {
    addBlocker("a", "moved"); // a is held by moved
    const w = move("moved", TASK_STATUS.done, 0, GAP);
    assert.ok(w.found);
    assert.deepEqual(w.released, ["a"]);
    assert.deepEqual(blockersOf("a"), []);
  });

  it("does not touch blockers when the task was already done", () => {
    const w = move("d1", TASK_STATUS.done, 0, GAP);
    assert.ok(w.found);
    assert.equal(w.released, null);
  });

  it("rebalances (integer fallback) when two siblings are too close", () => {
    // Bring a and b below MIN_GAP to force the integer fallback.
    db.update(schema.tasks).set({ boardOrder: 1 }).where(eq(schema.tasks.id, "a")).run();
    db.update(schema.tasks)
      .set({ boardOrder: 1 + 1e-9 })
      .where(eq(schema.tasks.id, "b"))
      .run();
    const w = move("moved", TASK_STATUS.todo, 1, GAP);
    assert.ok(w.found);
    assert.equal(w.rebalanced, true);
  });
});
