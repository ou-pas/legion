// The task to finish, and the transaction setting its transition (the blocker release it produces
// must land in the same one). Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-complete-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { findTaskRow, withTransaction } = await import("./complete-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "task",
    status: TASK_STATUS.doing,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("findTaskRow", () => {
  it("returns the row, or `undefined`", () => {
    assert.equal(findTaskRow("t1")?.name, "task");
    assert.equal(findTaskRow("never-seen"), undefined);
  });
});

describe("withTransaction", () => {
  it("runs the function under `db.transaction` and returns its value", () => {
    const result = withTransaction(() => {
      db.update(schema.tasks)
        .set({ status: TASK_STATUS.done })
        .where(eq(schema.tasks.id, "t1"))
        .run();
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(findTaskRow("t1")?.status, TASK_STATUS.done);
  });

  it("rolls the write back if the function throws", () => {
    assert.throws(() =>
      withTransaction(() => {
        db.update(schema.tasks)
          .set({ status: TASK_STATUS.review })
          .where(eq(schema.tasks.id, "t1"))
          .run();
        throw new Error("boom");
      }),
    );
    assert.equal(
      findTaskRow("t1")?.status,
      TASK_STATUS.done,
      "the rolled-back write did not stick",
    );
  });
});
