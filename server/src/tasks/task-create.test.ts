// What this file protects:
//
//  1. the returned task is the re-read row, with the columns the database fills itself (`queued`,
//     `archived`); the inserted object lied by omission, a caller got `queued: undefined` for a
//     task that was `false`;
//  2. blocker links are born in the same transaction as the task: an insert followed by a link
//     would open a window where `pumpQueue` takes the task before the link exists;
//  3. the refusal that needs the database (invalid links) is named.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-task-create-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { createTask } = await import("./task-create.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { COMPLEXITY, PRIORITY } = await import("./task-scales.js");
const { BRANCH_TYPE } = await import("./task-branch.js");

const P = "p1";
const OTHER = "p2";
const A = "a1";
const base = { name: "set up the harness", agentId: A, projectId: P } as const;

beforeEach(() => {
  const now = new Date();
  db.delete(schema.taskBlockers).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values([
      { id: P, name: "P", slug: "p1", createdAt: now },
      { id: OTHER, name: "Other", slug: "p2", createdAt: now },
    ])
    .run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "build", rolePrompt: "r", createdAt: now })
    .run();
});

function seedTask(id: string, projectId = P, status: "todo" | "done" = "todo") {
  const now = new Date();
  db.insert(schema.tasks)
    .values({ id, projectId, name: id, status, assigneeAgentId: A, createdAt: now, updatedAt: now })
    .run();
}

describe("createTask: the happy path", () => {
  it("returns the re-read row, with the database's and the domain's defaults", () => {
    const created = createTask({ ...base });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(
      created.task.queued,
      false,
      "the column filled by the database must be in the response",
    );
    assert.equal(created.task.archived, false);
    assert.equal(created.task.status, TASK_STATUS.todo);
    assert.equal(created.task.complexity, COMPLEXITY.med);
    assert.equal(created.task.priority, PRIORITY.med);
    assert.equal(created.task.type, BRANCH_TYPE.chore);
    assert.ok(created.task.boardOrder > 0, "the initial rank is the creation instant");
  });

  it("later is a birth status, and externalRef is stored serialised", () => {
    const created = createTask({
      ...base,
      status: TASK_STATUS.later,
      externalRef: { provider: "github", issueId: "12", identifier: "#12", url: "http://x/12" },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.task.status, TASK_STATUS.later);
    assert.match(created.task.externalRef ?? "", /github/);
  });
});

describe("createTask: blockers", () => {
  it("sets deduplicated links in the same transaction as the insert", () => {
    seedTask("b1");
    seedTask("b2");
    const created = createTask({ ...base, blockerIds: ["b1", "b2", "b1"] });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const links = db
      .select()
      .from(schema.taskBlockers)
      .where(eq(schema.taskBlockers.taskId, created.task.id))
      .all();
    assert.deepEqual(links.map((l) => l.blockerId).sort(), ["b1", "b2"]);
  });

  it("a blocker from another project is refused, and nothing is inserted", () => {
    seedTask("elsewhere", OTHER);
    const created = createTask({ ...base, blockerIds: ["elsewhere"] });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.equal(created.status, 400);
    assert.match(created.error, /another project/);
    assert.equal(
      db.select().from(schema.tasks).all().length,
      1,
      "only the seeded task must remain",
    );
  });

  it("a blocker already done is refused: a link holds nothing back", () => {
    seedTask("finished", P, "done");
    const created = createTask({ ...base, blockerIds: ["finished"] });
    assert.equal(created.ok, false);
    if (!created.ok) assert.match(created.error, /already done/);
  });
});
