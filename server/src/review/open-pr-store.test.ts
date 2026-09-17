// The store only reads and writes what it is asked; the rule (last push wins, pushed repositories)
// is tested in open-pr.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-open-pr-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mergeTaskPrUrls, pushEventsOf, sessionIdsOfTask, sessionRow, sessionsOfTask } =
  await import("./open-pr-store.js");

const PROJECT = "p1";
const AGENT = "a1";
const TASK = "t1";
const SESSION = "s1";

before(() => {
  const now = new Date();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      repoNames: JSON.stringify(["front", "back"]),
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
      prUrls: "[]",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: "r1", name: "r1", kind: "process" }).run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: AGENT,
      runnerId: "r1",
      model: "m",
      status: "running",
      callbackToken: "c-1",
      mock: false,
      startedAt: now,
    })
    .run();
  db.insert(schema.sessionEvents)
    .values({
      sessionId: SESSION,
      seq: 1,
      type: "repo_push",
      payload: JSON.stringify({ repo: "front", commit: "abc123", changes: 3 }),
      createdAt: now,
    })
    .run();
});

describe("open-pr-store", () => {
  it("sessionIdsOfTask and sessionsOfTask find the written session", () => {
    assert.deepEqual(sessionIdsOfTask(TASK), [SESSION]);
    assert.equal(sessionsOfTask(TASK).length, 1);
    assert.equal(sessionRow(SESSION)?.id, SESSION);
    assert.equal(sessionRow("absent"), null);
  });

  it("pushEventsOf returns session events, empty for an empty list", () => {
    assert.equal(pushEventsOf([SESSION]).length, 1);
    assert.deepEqual(pushEventsOf([]), []);
  });

  it("mergeTaskPrUrls writes the task's prUrls column", () => {
    mergeTaskPrUrls(TASK, JSON.stringify([{ repo: "front", url: "https://x/pr/1" }]));
    const row = db
      .select()
      .from(schema.tasks)
      .all()
      .find((t) => t.id === TASK);
    assert.equal(row?.prUrls, JSON.stringify([{ repo: "front", url: "https://x/pr/1" }]));
  });
});
