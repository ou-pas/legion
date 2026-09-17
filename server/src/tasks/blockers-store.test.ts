// The only code touching `task_blockers`: setting/removing a link, both edge directions, the three
// named queries `releaseDependentsOf` (`blockers.ts`) composes its release rule from, and the
// candidates for `validateBlockerLinks`'s guards. The rule itself ("the last blocker to finish
// releases, once") is tested in `blockers.test.ts`. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-blockers-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  addBlocker,
  blockedAmong,
  blockedTaskIds,
  blockersByTask,
  blockersOf,
  candidateTasksByIds,
  consumeBlockersOf,
  deleteBlockersFrom,
  dependentsOf,
  heldBy,
  removeBlocker,
} = await import("./blockers-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
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
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "b",
        projectId: P,
        name: "B",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "c",
        projectId: P,
        name: "C",
        status: TASK_STATUS.done,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
}

describe("addBlocker / blockersOf / dependentsOf", () => {
  beforeEach(() => reset());

  it("sets a link readable both ways, idempotent", () => {
    addBlocker("a", "b");
    addBlocker("a", "b"); // restating is not a fault
    assert.deepEqual(blockersOf("a"), ["b"]);
    assert.deepEqual(dependentsOf("b"), ["a"]);
    assert.deepEqual(blockersOf("b"), []);
  });
});

describe("blockersByTask", () => {
  beforeEach(() => reset());

  it("names each task's blockers in one pass, the whole table with no argument", () => {
    addBlocker("a", "b");
    addBlocker("a", "c");
    const map = blockersByTask(["a"]);
    assert.deepEqual(
      map
        .get("a")
        ?.map((r) => r.id)
        .sort(),
      ["b", "c"],
    );
    assert.deepEqual(blockersByTask([]), new Map());
    assert.deepEqual(blockersByTask().get("a")?.length, 2);
  });
});

describe("blockedTaskIds", () => {
  beforeEach(() => reset());

  it("returns the set of tasks held by at least one link", () => {
    addBlocker("a", "b");
    assert.deepEqual(blockedTaskIds(), new Set(["a"]));
  });
});

describe("heldBy / deleteBlockersFrom / blockedAmong: releaseDependentsOf's queries", () => {
  beforeEach(() => reset());

  it("heldBy returns the tasks this blocker holds", () => {
    addBlocker("a", "c"); // a is held by c
    assert.deepEqual(heldBy("c"), ["a"]);
    assert.deepEqual(heldBy("b"), []);
  });

  it("deleteBlockersFrom erases every link where the id is the blocker, nothing else", () => {
    addBlocker("a", "c");
    addBlocker("b", "c");
    addBlocker("a", "b"); // b blocks another link: must stay
    deleteBlockersFrom("c");
    assert.deepEqual(blockersOf("a"), ["b"]);
    assert.deepEqual(blockersOf("b"), []);
  });

  it("blockedAmong returns those, among the given ids, still held by at least one blocker, [] for an empty list", () => {
    addBlocker("a", "b");
    assert.deepEqual(blockedAmong(["a", "c"]), new Set(["a"]));
    assert.deepEqual(blockedAmong([]), new Set());
  });

  it("consumeBlockersOf erases all of a task's blockers", () => {
    addBlocker("a", "b");
    addBlocker("a", "c");
    consumeBlockersOf("a");
    assert.deepEqual(blockersOf("a"), []);
  });
});

describe("removeBlocker", () => {
  beforeEach(() => reset());

  it("removes one link and only one, idempotent", () => {
    addBlocker("a", "b");
    addBlocker("a", "c");
    removeBlocker("a", "b");
    removeBlocker("a", "b"); // removing an absent link is not a fault
    assert.deepEqual(blockersOf("a"), ["c"]);
  });
});

describe("candidateTasksByIds", () => {
  beforeEach(() => reset());

  it("returns id/name/status/project of the candidates, nothing for an empty list", () => {
    const rows = candidateTasksByIds(["a", "c"]);
    assert.deepEqual(rows.map((r) => r.id).sort(), ["a", "c"]);
    const c = rows.find((r) => r.id === "c");
    assert.equal(c?.status, TASK_STATUS.done);
    assert.equal(c?.projectId, P);
    assert.deepEqual(candidateTasksByIds([]), []);
  });
});
