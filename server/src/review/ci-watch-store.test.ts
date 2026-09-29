// The store only reads and writes what it is asked; the decision (what a state means, what to do
// about it) is tested in ci-watch.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-ci-watch-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { ciWatchStateRow, saveCiWatchState, tasksInReviewWithProjectFlags } =
  await import("./ci-watch-store.js");

const WATCHED = "p-watched"; // ci_watch on (the column default), not demo
const OFF = "p-off"; // ci_watch explicitly off
const DEMO = "p-demo"; // ci_watch on, but the demo project

before(() => {
  const now = new Date();
  db.insert(schema.projects)
    .values([
      { id: WATCHED, name: "Watched", slug: "watched", createdAt: now },
      { id: OFF, name: "Off", slug: "off", ciWatch: false, createdAt: now },
      { id: DEMO, name: "Demo", slug: "demo", demo: true, createdAt: now },
    ])
    .run();
  const task = (id: string, projectId: string, status: "review" | "todo") =>
    db
      .insert(schema.tasks)
      .values({ id, projectId, name: id, description: "", status, createdAt: now, updatedAt: now })
      .run();
  task("t-watched-review", WATCHED, "review");
  task("t-watched-todo", WATCHED, "todo");
  task("t-off-review", OFF, "review");
  task("t-demo-review", DEMO, "review");
});

describe("tasksInReviewWithProjectFlags", () => {
  it("returns every review task with its project's flags, whatever they are", () => {
    // The switch/demo filter is `ciWatchEnabledFor`'s job (ci-watch.ts), not this query's: it
    // returns the facts, the caller decides. All three review tasks come back.
    const rows = tasksInReviewWithProjectFlags();
    const byId = new Map(rows.map((r) => [r.task.id, r]));
    assert.equal(byId.size, 3);
    assert.deepEqual(byId.get("t-watched-review")?.project, { ciWatch: true, demo: false });
    assert.deepEqual(byId.get("t-off-review")?.project, { ciWatch: false, demo: false });
    assert.deepEqual(byId.get("t-demo-review")?.project, { ciWatch: true, demo: true });
    assert.ok(!byId.has("t-watched-todo"), "a todo task must not come back");
  });
});

describe("ciWatchStateRow / saveCiWatchState", () => {
  it("returns null for a PR never seen red", () => {
    assert.equal(ciWatchStateRow("t-watched-review", "backend", 1), null);
  });

  it("persists the counter, readable back — survives what a reload would do", () => {
    saveCiWatchState(
      "t-watched-review",
      "backend",
      7,
      { attempts: 2, notified: false },
      new Date(),
    );
    assert.deepEqual(ciWatchStateRow("t-watched-review", "backend", 7), {
      attempts: 2,
      notified: false,
    });
  });

  it("a second save on the same key updates in place, no duplicate row", () => {
    saveCiWatchState(
      "t-watched-review",
      "backend",
      8,
      { attempts: 1, notified: false },
      new Date(),
    );
    saveCiWatchState("t-watched-review", "backend", 8, { attempts: 3, notified: true }, new Date());
    assert.deepEqual(ciWatchStateRow("t-watched-review", "backend", 8), {
      attempts: 3,
      notified: true,
    });
    const rows = db
      .select()
      .from(schema.ciWatchState)
      .where(eqAll("t-watched-review", "backend", 8))
      .all();
    assert.equal(rows.length, 1);
  });

  it("keys are per (task, repo, number): two PRs on the same task stay independent", () => {
    saveCiWatchState(
      "t-watched-review",
      "backend",
      9,
      { attempts: 1, notified: false },
      new Date(),
    );
    saveCiWatchState(
      "t-watched-review",
      "frontend",
      9,
      { attempts: 2, notified: false },
      new Date(),
    );
    assert.deepEqual(ciWatchStateRow("t-watched-review", "backend", 9), {
      attempts: 1,
      notified: false,
    });
    assert.deepEqual(ciWatchStateRow("t-watched-review", "frontend", 9), {
      attempts: 2,
      notified: false,
    });
  });
});

function eqAll(taskId: string, repoName: string, number: number) {
  return and(
    eq(schema.ciWatchState.taskId, taskId),
    eq(schema.ciWatchState.repoName, repoName),
    eq(schema.ciWatchState.number, number),
  );
}
