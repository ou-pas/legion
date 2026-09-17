// The store only reads and writes what it is asked; the decision (partial merge, deduplication)
// is tested in merge-events.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-merge-events-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { logControlEvent } = await import("../events/control-log-store.js");
const { controlEventsMentioning, insertTaskActivity, taskActivityOf, tasksInReview } =
  await import("./merge-events-store.js");

const PROJECT = "p1";
const TASK_REVIEW = "t-review";
const TASK_TODO = "t-todo";

before(() => {
  const now = new Date();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.tasks)
    .values({
      id: TASK_REVIEW,
      projectId: PROJECT,
      name: "in review",
      description: "brief",
      status: "review",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: TASK_TODO,
      projectId: PROJECT,
      name: "todo",
      description: "brief",
      status: "todo",
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

describe("merge-events-store", () => {
  it("tasksInReview returns only tasks in review", () => {
    assert.deepEqual(
      tasksInReview()
        .map((t) => t.id)
        .sort(),
      [TASK_REVIEW],
    );
  });

  it("insertTaskActivity then taskActivityOf finds it", () => {
    insertTaskActivity({
      id: "act1",
      taskId: TASK_REVIEW,
      from: "system",
      body: "merged",
      createdAt: new Date(),
    });
    assert.equal(taskActivityOf(TASK_REVIEW).length, 1);
    assert.equal(taskActivityOf(TASK_TODO).length, 0);
  });

  it("controlEventsMentioning filters by webhooks source and id substring", () => {
    logControlEvent("info", "webhooks", `task ${TASK_REVIEW}: partial merge`, {
      taskId: TASK_REVIEW,
    });
    logControlEvent("info", "other-source", `task ${TASK_REVIEW}: noise`, {});
    const rows = controlEventsMentioning(TASK_REVIEW);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.source === "webhooks"));
  });
});
