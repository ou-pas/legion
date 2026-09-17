// What is checked here is the order: "the last row of the feed" breaks ties between two writes of
// the same millisecond with SQLite's `rowid`, not the nanoid id, which made the sort random once
// in three runs.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-lot-refusal-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { insertTaskActivity, taskActivityNewestFirst } = await import("./lot-refusal-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "T1",
    status: "review",
    boardOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("lot-refusal-store", () => {
  it("an empty feed is an empty list, not an error", () => {
    assert.deepEqual(taskActivityNewestFirst("t1"), []);
  });

  it("returns the feed newest first, rowid breaking ties", () => {
    const rows: [string, string][] = [
      ["act1", "first"],
      ["act2", "second"],
      ["act3", "third"],
    ];
    for (const [id, body] of rows)
      insertTaskActivity({ id, taskId: "t1", from: "human", body, createdAt: now });
    assert.deepEqual(
      taskActivityNewestFirst("t1").map((r) => r.body),
      ["third", "second", "first"],
    );
  });

  it("returns only the requested task's feed", () => {
    assert.deepEqual(taskActivityNewestFirst("t-unknown"), []);
  });
});
