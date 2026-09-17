// The side door (nav/04, AC#2): "open" is not "create on every click", and the opened project is
// one the server refuses to run. A demo launching sessions would cost money to someone who came to
// look.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-demo-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, isDemoProject, schema } = await import("../shared/db.js");
const { DEMO_SLUG, ensureDemoProject } = await import("./demo.js");
const { eq } = await import("drizzle-orm");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

describe("ensureDemoProject: a door, not a project factory", () => {
  it("creates the project on first call and finds it on the second", () => {
    const first = ensureDemoProject();
    assert.equal(first.created, true);
    const second = ensureDemoProject();
    assert.equal(second.created, false);
    assert.equal(second.id, first.id, "the door must reopen the same project");
    const rows = db.select().from(schema.projects).where(eq(schema.projects.slug, DEMO_SLUG)).all();
    assert.equal(rows.length, 1);
  });

  it("carries the demo flag, so no agent launches there", () => {
    const { id } = ensureDemoProject();
    // runTask, resume and the goal loop read this flag.
    assert.equal(isDemoProject(id), true);
  });

  it("comes with something to look at: an environment, an agent and three spread cards", () => {
    const { id } = ensureDemoProject();
    assert.equal(
      db.select().from(schema.environments).where(eq(schema.environments.projectId, id)).all()
        .length,
      1,
    );
    assert.equal(
      db.select().from(schema.agents).where(eq(schema.agents.projectId, id)).all().length,
      1,
    );
    const tasks = db.select().from(schema.tasks).where(eq(schema.tasks.projectId, id)).all();
    assert.equal(tasks.length, 3);
    // Three distinct columns: a board with every card in one pile does not show what a board is.
    assert.deepEqual([...new Set(tasks.map((t) => t.status))].sort(), [
      TASK_STATUS.doing,
      TASK_STATUS.review,
      TASK_STATUS.todo,
    ]);
  });
});
