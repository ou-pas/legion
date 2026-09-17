// The store only reads and writes what it is asked, with no decision; decisions (validation,
// statuses) are tested in review.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-review-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  deleteReviewCommentRow,
  insertReviewComment,
  reposOfProject,
  reviewCommentRow,
  reviewCommentsOfTask,
  reviewCommentsOfTaskByStatus,
  setReviewCommentsStatus,
  sessionsOfTask,
  taskRow,
} = await import("./review-store.js");

const PROJECT = "p1";
const TASK = "t1";

before(() => {
  const now = new Date();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.repos)
    .values({
      id: "r1",
      projectId: PROJECT,
      name: "front",
      url: "https://x/front.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "task",
      description: "brief",
      status: "todo",
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

beforeEach(() => {
  db.delete(schema.reviewComments).run();
});

describe("review-store", () => {
  it("taskRow returns the task or null", () => {
    assert.equal(taskRow(TASK)?.id, TASK);
    assert.equal(taskRow("absent"), null);
  });

  it("reposOfProject returns the project's repositories", () => {
    assert.deepEqual(
      reposOfProject(PROJECT).map((r) => r.name),
      ["front"],
    );
  });

  it("sessionsOfTask returns an empty array with no session", () => {
    assert.deepEqual(sessionsOfTask(TASK), []);
  });

  it("insertReviewComment then reviewCommentsOfTask/reviewCommentRow find it", () => {
    const row = {
      id: "c1",
      taskId: TASK,
      repoName: "front",
      filePath: "src/app.tsx",
      line: 1,
      side: "new" as const,
      startLine: null,
      excerpt: "",
      body: "fix this",
      status: "open" as const,
      createdAt: new Date(),
    };
    insertReviewComment(row);
    assert.equal(reviewCommentsOfTask(TASK).length, 1);
    assert.equal(reviewCommentRow("c1")?.body, "fix this");
    assert.equal(reviewCommentRow("absent"), null);
  });

  it("reviewCommentsOfTaskByStatus filters by status, setReviewCommentsStatus changes it", () => {
    insertReviewComment({
      id: "c2",
      taskId: TASK,
      repoName: "front",
      filePath: "a.ts",
      line: 1,
      side: "new",
      startLine: null,
      excerpt: "",
      body: "b",
      status: "open",
      createdAt: new Date(),
    });
    assert.equal(reviewCommentsOfTaskByStatus(TASK, "open").length, 1);
    assert.equal(reviewCommentsOfTaskByStatus(TASK, "sent").length, 0);
    setReviewCommentsStatus(["c2"], "sent", new Date());
    assert.equal(reviewCommentsOfTaskByStatus(TASK, "open").length, 0);
    assert.equal(reviewCommentsOfTaskByStatus(TASK, "sent").length, 1);
  });

  it("deleteReviewCommentRow removes the row", () => {
    insertReviewComment({
      id: "c3",
      taskId: TASK,
      repoName: "front",
      filePath: "a.ts",
      line: 1,
      side: "new",
      startLine: null,
      excerpt: "",
      body: "b",
      status: "open",
      createdAt: new Date(),
    });
    deleteReviewCommentRow("c3");
    assert.equal(reviewCommentRow("c3"), null);
  });
});
