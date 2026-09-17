// "Dependencies become a graph" ("decoupe" spec, behaviour 8), phases EXPAND (slice 01), MIGRATE
// (slice 02) and CONTRACT (slice 03):
//
//  1. Migrations. v44 copies the single column into the table: a v43 database with blocked tasks,
//     migrated, carries one join row per blocked task and no more; a ghost blocker (the column had
//     no FK) is cleaned rather than copied. v45 drops the column: a v44 database loses it and keeps
//     every join row. A fresh database reaches the same schema; replaying changes nothing.
//  2. The four writers only write the table: chain instantiation, a blocking filing (`propose_task`
//     + `blocking`), a blocker's done, a task's deletion. Including the second blocking filing,
//     which adds a link instead of being refused, and the `later` dependent the done unlinks
//     without launching.
//  3. The module itself: `releaseDependentsOf` only returns a task when nothing holds it any more;
//     `blockersByTask` names blockers in one query; `blockedTaskIds` says who is held.
//  4. The launch guard refuses a blocked task, naming all its blockers.
//  5. The column no longer exists: outside the migrations that added, copied and removed it, no
//     server, schema or screen file mentions it.
//
// Real temporary SQLite, like task-propose.test.ts. The migration part opens its own files alongside,
// to start from an old schema `db.js` can no longer produce.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-blockers-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { HEAD_VERSION, runMigrations } = await import("../shared/migrations/index.js");
const { steps: s1 } = await import("../shared/migrations/v1-v10.js");
const { steps: s2 } = await import("../shared/migrations/v11-v20.js");
const { steps: s3 } = await import("../shared/migrations/v21-v30.js");
const { steps: s4 } = await import("../shared/migrations/v31-v40.js");
const { steps: s5 } = await import("../shared/migrations/v41-v45.js");
const { steps: s6 } = await import("../shared/migrations/v46-v50.js");
const ALL_STEPS = [...s1, ...s2, ...s3, ...s4, ...s5, ...s6];
/** The highest step, read from the steps themselves. Hard-coded, it broke this suite at every next
 *  migration (v46, `tasks.criteria`, showed it): what these tests protect is v44 and v45, not
 *  today's number.
 *
 *  It now comes from `migrations/index.js` (v51) rather than the local list: that list is only
 *  complete as long as someone remembers to add the next decade's file, which replayed exactly the
 *  defect it meant to avoid. */
const HEAD = HEAD_VERSION;

// All imports before the first describe: an `await import` between two suites makes the runner
// think the file is done, and the `after` above erases the folder under the database.
const { db, schema } = await import("../shared/db.js");
const {
  addBlocker,
  removeBlocker,
  validateBlockerLinks,
  blockersOf,
  blockersByTask,
  blockedTaskIds,
  releaseDependentsOf,
  consumeBlockersOf,
} = await import("./blockers.js");
const { instantiateTemplate, onTaskDone, settleDone } = await import("../chains/templates.js");
const { proposeTask } = await import("./task-propose.js");
const { deleteTask } = await import("../projects/purge.js");
const { runTask } = await import("../sessions/runner/manager.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

/** A chain, unwrapped. `instantiateTemplate` returns its refusal since 06/09 instead of throwing: an
 *  unexpected refusal must fail the test by naming it. */
const chainOf = (templateId: string, request: string) => {
  const r = instantiateTemplate(templateId, request);
  assert.ok(r.ok, r.ok ? "" : `unexpected refusal: ${r.error}`);
  return r.value;
};

/** Silences `process.stdout` rather than `console.log` (batch 4): `shared/log.ts` writes to
 *  `process.stdout`, which lets the `no-console` gate cover all of `server/src`. */
function quiet<T>(fn: () => T): T {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = write;
  }
}
/** Applies missing steps up to `version` included, without the migration log noise. `runMigrations`
 *  always goes to the end; here we stop where the test asks, to look at one migration before the
 *  next changes the table under it. */
function migrateTo(sqlite: Database.Database, version: number): void {
  const current = sqlite.pragma("user_version", { simple: true }) as number;
  quiet(() => {
    for (const [v, apply] of ALL_STEPS) if (v > current && v <= version) apply(sqlite);
  });
}
/** A fresh database brought to step `version`. */
function openAt(version: number, name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  sqlite.pragma("foreign_keys = ON");
  migrateTo(sqlite, version);
  return sqlite;
}
const tableShape = (s: Database.Database, table: string) => ({
  columns: s.pragma(`table_info(${table})`),
  indexes: (s.pragma(`index_list(${table})`) as { name: string }[]).map((i) => i.name).sort(),
  fks: s.pragma(`foreign_key_list(${table})`),
});

describe("v44: the migration copies the column into task_blockers", () => {
  it("a v43 database with blocked tasks: one row per blocked task, no more", () => {
    const sqlite = openAt(43, "v43.db");
    assert.equal(sqlite.pragma("user_version", { simple: true }), 43);
    sqlite.exec(`
      INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', 0);
      INSERT INTO tasks (id, project_id, name, created_at, updated_at, blocked_by_task_id) VALUES
        ('A', 'p', 'a', 0, 0, NULL),
        ('B', 'p', 'b', 0, 0, 'A'),
        ('C', 'p', 'c', 0, 0, 'A'),
        ('D', 'p', 'd', 0, 0, NULL),
        ('E', 'p', 'e', 0, 0, 'ghost');
    `);
    migrateTo(sqlite, 44);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 44);
    const rows = sqlite
      .prepare("SELECT task_id, blocker_id FROM task_blockers ORDER BY task_id")
      .all();
    assert.deepEqual(rows, [
      { task_id: "B", blocker_id: "A" },
      { task_id: "C", blocker_id: "A" },
    ]);
  });

  it("the ghost blocker is removed from the column, not copied", () => {
    const sqlite = openAt(43, "ghost.db");
    sqlite.exec(`
      INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', 0);
      INSERT INTO tasks (id, project_id, name, created_at, updated_at, blocked_by_task_id) VALUES
        ('E', 'p', 'e', 0, 0, 'ghost');
    `);
    migrateTo(sqlite, 44);
    assert.equal(
      (
        sqlite.prepare("SELECT blocked_by_task_id AS b FROM tasks WHERE id = 'E'").get() as {
          b: string | null;
        }
      ).b,
      null,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS n FROM task_blockers").get() as { n: number }).n,
      0,
    );
  });

  it("a fresh database reaches the same task_blockers schema as a migrated one", () => {
    const migrated = openAt(43, "old.db");
    quiet(() => runMigrations(migrated));
    const fresh = new Database(join(dir, "fresh.db"));
    assert.equal(quiet(() => runMigrations(fresh)).to, HEAD);
    assert.deepEqual(tableShape(fresh, "task_blockers"), tableShape(migrated, "task_blockers"));
    assert.ok(
      (tableShape(fresh, "task_blockers").indexes as string[]).includes(
        "idx_task_blockers_blocker",
      ),
    );
  });
});

describe("v45: the migration drops the column, task_blockers stays", () => {
  it("SQLite can DROP COLUMN (3.35.0): the migration's precondition, read here rather than in a failing boot", () => {
    const version = (
      new Database(":memory:").prepare("SELECT sqlite_version() AS v").get() as { v: string }
    ).v;
    const [major = 0, minor = 0] = version.split(".").map(Number);
    assert.ok(major > 3 || (major === 3 && minor >= 35), `SQLite ${version} cannot DROP COLUMN`);
  });

  it("a v44 database with links: the column goes, every join row and every task survives", () => {
    const sqlite = openAt(44, "v44.db");
    assert.equal(sqlite.pragma("user_version", { simple: true }), 44);
    sqlite.exec(`
      INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', 0);
      INSERT INTO tasks (id, project_id, name, created_at, updated_at, blocked_by_task_id) VALUES
        ('A', 'p', 'a', 0, 0, NULL), ('B', 'p', 'b', 0, 0, 'A'), ('C', 'p', 'c', 0, 0, 'A'), ('D', 'p', 'd', 0, 0, NULL);
      INSERT INTO task_blockers (task_id, blocker_id, created_at) VALUES ('B', 'A', 0), ('C', 'A', 0), ('C', 'D', 0);
    `);
    assert.deepEqual(
      quiet(() => runMigrations(sqlite)),
      { from: 44, to: HEAD },
    );
    const columns = (sqlite.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name);
    assert.ok(!columns.includes("blocked_by_task_id"), "the column is gone");
    assert.ok(
      columns.includes("step_index") && columns.includes("expected_artifacts"),
      "its neighbours stayed",
    );
    assert.deepEqual(
      sqlite
        .prepare("SELECT task_id, blocker_id FROM task_blockers ORDER BY task_id, blocker_id")
        .all(),
      [
        { task_id: "B", blocker_id: "A" },
        { task_id: "C", blocker_id: "A" },
        { task_id: "C", blocker_id: "D" },
      ],
    );
    assert.deepEqual(sqlite.prepare("SELECT id, name FROM tasks ORDER BY id").all(), [
      { id: "A", name: "a" },
      { id: "B", name: "b" },
      { id: "C", name: "c" },
      { id: "D", name: "d" },
    ]);
  });

  it("replaying migrations changes nothing", () => {
    const sqlite = openAt(43, "replay.db");
    sqlite.exec(`
      INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', 0);
      INSERT INTO tasks (id, project_id, name, created_at, updated_at, blocked_by_task_id) VALUES
        ('A', 'p', 'a', 0, 0, NULL), ('B', 'p', 'b', 0, 0, 'A');
    `);
    assert.deepEqual(
      quiet(() => runMigrations(sqlite)),
      { from: 43, to: HEAD },
    );
    assert.deepEqual(
      quiet(() => runMigrations(sqlite)),
      { from: HEAD, to: HEAD },
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS n FROM task_blockers").get() as { n: number }).n,
      1,
    );
  });

  it("a fresh database reaches the same tasks schema as a migrated one", () => {
    const migrated = openAt(44, "old45.db");
    quiet(() => runMigrations(migrated));
    const fresh = new Database(join(dir, "fresh45.db"));
    assert.equal(quiet(() => runMigrations(fresh)).to, HEAD);
    assert.deepEqual(tableShape(fresh, "tasks"), tableShape(migrated, "tasks"));
  });
});

// Writers, on db.js's database.

const P1 = "p1";
const A1 = "a1";
const RUNNER = "r1";
const ORIGIN = "t-origin";
const SESSION = "s1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run(); // task_blockers follows by CASCADE
  db.delete(schema.taskTemplates).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

/** A free task without an agent: the queue never takes it, no runner is called. */
function makeTask(id: string, extra: Partial<typeof schema.tasks.$inferInsert> = {}) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: P1,
      name: id,
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
      ...extra,
    })
    .run();
}
const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const settle = () => new Promise((r) => setTimeout(r, 20)); // onTaskDone's fire-and-forget follow-ups

/** Done as its three callers do it: status and `settleDone` in one transaction, then the
 *  follow-ups. */
function finish(id: string): string[] {
  const released = db.transaction(() => {
    db.update(schema.tasks).set({ status: TASK_STATUS.done }).where(eq(schema.tasks.id, id)).run();
    return settleDone(id);
  });
  onTaskDone(id, released);
  return released;
}

describe("the four writers only write the table", () => {
  beforeEach(() => reset());

  it("chain instantiation: each step carries the link to the previous one, the first none", () => {
    const step = (name: string) => ({
      name,
      agentName: "a1",
      approvalGate: false,
      expectedArtifacts: [],
      prompt: "p",
    });
    db.insert(schema.taskTemplates)
      .values({
        id: "tpl",
        projectId: P1,
        name: "chain",
        steps: JSON.stringify([step("1"), step("2"), step("3")]),
        autoRunNext: false,
        createdAt: new Date(),
      })
      .run();
    const { taskIds } = chainOf("tpl", "request");
    assert.equal(taskIds.length, 3);
    assert.deepEqual(blockersOf(taskIds[0]!), []);
    assert.deepEqual(blockersOf(taskIds[1]!), [taskIds[0]]);
    assert.deepEqual(blockersOf(taskIds[2]!), [taskIds[1]]);
  });

  it("a blocking filing: the origin task carries the link; a second blocking filing adds a second, it waits for both", () => {
    const now = new Date();
    makeTask(ORIGIN, { status: TASK_STATUS.doing, assigneeAgentId: A1 });
    db.insert(schema.sessions)
      .values({
        id: SESSION,
        taskId: ORIGIN,
        agentId: A1,
        runnerId: RUNNER,
        model: "sonnet",
        status: "running",
        callbackToken: "tok",
        startedAt: now,
      })
      .run();
    const first = proposeTask(SESSION, { name: "leftover", brief: "b", blocking: true });
    assert.ok(first.ok && first.blocked);
    if (!first.ok) return;
    assert.deepEqual(blockersOf(ORIGIN), [first.task.id]);

    const second = proposeTask(SESSION, { name: "other", brief: "b", blocking: true });
    assert.ok(second.ok && second.blocked, "a second link, not a refusal");
    if (!second.ok) return;
    assert.deepEqual(blockersOf(ORIGIN).sort(), [first.task.id, second.task.id].sort());
  });

  it("a free blocker's done: the todo dependent is released, the later one unlinked but stays parked", async () => {
    makeTask("blocker");
    makeTask("t-todo");
    makeTask("t-later", { status: TASK_STATUS.later });
    addBlocker("t-todo", "blocker");
    addBlocker("t-later", "blocker");
    assert.deepEqual(
      finish("blocker").sort(),
      ["t-later", "t-todo"],
      "both are released: the link is an event, not a status",
    );
    await settle();
    for (const id of ["t-todo", "t-later"]) assert.deepEqual(blockersOf(id), []);
    assert.equal(
      taskRow("t-later")?.status,
      TASK_STATUS.later,
      "later never moves on its own: unlinked, not launched",
    );
  });

  it("a chain step's done releases the next one", async () => {
    const step = (name: string) => ({
      name,
      agentName: "a1",
      approvalGate: false,
      expectedArtifacts: [],
      prompt: "p",
    });
    db.insert(schema.taskTemplates)
      .values({
        id: "tpl",
        projectId: P1,
        name: "chain",
        steps: JSON.stringify([step("1"), step("2")]),
        autoRunNext: false,
        createdAt: new Date(),
      })
      .run();
    const {
      taskIds: [s1, s2],
    } = chainOf("tpl", "request");
    assert.deepEqual(finish(s1!), [s2]);
    await settle();
    assert.deepEqual(blockersOf(s2!), []);
  });

  it("deleting a blocker releases its dependents, whatever their status", () => {
    makeTask("blocker");
    makeTask("t-todo");
    makeTask("t-later", { status: TASK_STATUS.later });
    addBlocker("t-todo", "blocker");
    addBlocker("t-later", "blocker");
    deleteTask("blocker");
    assert.equal(taskRow("blocker"), undefined);
    for (const id of ["t-todo", "t-later"]) assert.deepEqual(blockersOf(id), []);
  });

  it("deleting a blocked task takes its links with it", () => {
    makeTask("blocker");
    makeTask("t");
    addBlocker("t", "blocker");
    deleteTask("t");
    assert.equal(db.select().from(schema.taskBlockers).all().length, 0);
  });
});

describe("blockers: the module", () => {
  beforeEach(() => reset());

  it("addBlocker is idempotent", () => {
    makeTask("A");
    makeTask("B");
    makeTask("t");
    addBlocker("t", "A");
    addBlocker("t", "A");
    addBlocker("t", "B");
    assert.deepEqual(blockersOf("t").sort(), ["A", "B"]);
  });

  it("releaseDependentsOf only returns a task when nothing holds it any more: the last releases, once", () => {
    makeTask("A");
    makeTask("B");
    makeTask("t");
    makeTask("u");
    addBlocker("t", "A");
    addBlocker("t", "B");
    addBlocker("u", "A");
    assert.deepEqual(releaseDependentsOf("A"), ["u"], "t still has B; u only had A");
    assert.deepEqual(blockersOf("t"), ["B"]);
    assert.deepEqual(releaseDependentsOf("B"), ["t"]);
    assert.deepEqual(releaseDependentsOf("B"), [], "a consumed event does not replay");
  });

  it("consumeBlockersOf erases what held the task, and nothing else", () => {
    makeTask("A");
    makeTask("t");
    makeTask("u");
    addBlocker("t", "A");
    addBlocker("u", "A");
    consumeBlockersOf("t");
    assert.deepEqual(blockersOf("t"), []);
    assert.deepEqual(blockersOf("u"), ["A"]);
  });

  it("blockersByTask names each task's blockers, with their status, in one batch; blockedTaskIds says who is held", () => {
    makeTask("A", { name: "Audit the flow", status: TASK_STATUS.done });
    makeTask("B", { name: "Make it idempotent", status: TASK_STATUS.doing });
    makeTask("t");
    makeTask("u");
    makeTask("free");
    addBlocker("t", "A");
    addBlocker("t", "B");
    addBlocker("u", "B");
    const all = blockersByTask();
    assert.deepEqual(
      all.get("t")?.map((b) => [b.id, b.name, b.status]),
      [
        ["A", "Audit the flow", TASK_STATUS.done],
        ["B", "Make it idempotent", TASK_STATUS.doing],
      ],
    );
    assert.deepEqual(
      all.get("u")?.map((b) => b.id),
      ["B"],
    );
    assert.equal(all.get("free"), undefined, "free = absent from the map");
    assert.deepEqual([...blockersByTask(["u"]).keys()], ["u"], "the requested batch, nothing else");
    assert.equal(blockersByTask([]).size, 0, "an empty batch asks nothing");
    assert.deepEqual([...blockedTaskIds()].sort(), ["t", "u"]);
  });
});

describe("removeBlocker: the fifth writer, targeted", () => {
  beforeEach(() => reset());

  it("removes one link, leaves the others", () => {
    makeTask("A");
    makeTask("B");
    makeTask("t");
    addBlocker("t", "A");
    addBlocker("t", "B");
    removeBlocker("t", "A");
    assert.deepEqual(blockersOf("t"), ["B"]);
  });

  it("idempotent: removing an absent link is not a fault", () => {
    makeTask("A");
    makeTask("t");
    assert.doesNotThrow(() => removeBlocker("t", "A"));
    assert.deepEqual(blockersOf("t"), []);
  });
});

describe("validateBlockerLinks: the four guards an HTTP caller can violate", () => {
  beforeEach(() => reset());

  it("everything passes → null", () => {
    makeTask("A");
    makeTask("t");
    assert.equal(validateBlockerLinks("t", ["A"], P1), null);
  });

  it("empty list → null, nothing to validate", () => {
    makeTask("t");
    assert.equal(validateBlockerLinks("t", [], P1), null);
  });

  it("self-blocking refused", () => {
    makeTask("t");
    const err = validateBlockerLinks("t", ["t"], P1);
    assert.ok(err && err.status === 400 && /cannot block itself/.test(err.error));
  });

  it("missing blocker → 400, the id named", () => {
    makeTask("t");
    const err = validateBlockerLinks("t", ["does-not-exist"], P1);
    assert.ok(err && err.status === 400 && err.error.includes("does-not-exist"));
  });

  it("blocker from another project → 400, named", () => {
    const now = new Date();
    db.insert(schema.projects).values({ id: "p2", name: "P2", slug: "p2", createdAt: now }).run();
    db.insert(schema.tasks)
      .values({
        id: "foreign",
        projectId: "p2",
        name: "Elsewhere",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    makeTask("t");
    const err = validateBlockerLinks("t", ["foreign"], P1);
    assert.ok(err && err.status === 400 && err.error.includes("Elsewhere"));
  });

  it("blocker already done → 400: a dead link is not set", () => {
    makeTask("A", { name: "Already finished", status: TASK_STATUS.done });
    makeTask("t");
    const err = validateBlockerLinks("t", ["A"], P1);
    assert.ok(err && err.status === 400 && err.error.includes("Already finished"));
  });

  it("direct cycle (A blocks B, we want B to block A) → 400, named", () => {
    makeTask("A");
    makeTask("B");
    addBlocker("B", "A"); // B waits for A
    const err = validateBlockerLinks("A", ["B"], P1); // A would wait for B → cycle
    assert.ok(err && err.status === 400 && /cycle/.test(err.error));
  });

  it("indirect cycle (A→B→C, we want C to block A) → 400", () => {
    makeTask("A");
    makeTask("B");
    makeTask("C");
    addBlocker("B", "A"); // B waits for A
    addBlocker("C", "B"); // C waits for B
    const err = validateBlockerLinks("A", ["C"], P1); // A would wait for C → loop A→C→B→A
    assert.ok(err && err.status === 400 && /cycle/.test(err.error));
  });

  it("no false positive: two independent tasks blocking the same third stay valid", () => {
    makeTask("A");
    makeTask("B");
    makeTask("t");
    addBlocker("t", "A");
    const err = validateBlockerLinks("t", ["B"], P1);
    assert.equal(err, null);
  });
});

describe("the launch guard: a blocked task does not launch by hand", () => {
  beforeEach(() => reset());

  it("refuses naming all blockers, with their status", async () => {
    makeTask("A", { name: "Audit the flow" });
    makeTask("B", { name: "Make it idempotent", status: TASK_STATUS.doing });
    makeTask("t", { assigneeAgentId: A1 });
    addBlocker("t", "A");
    addBlocker("t", "B");
    await assert.rejects(runTask("t"), (err: Error) => {
      assert.match(err.message, /“Audit the flow” \(todo\)/);
      assert.match(err.message, /“Make it idempotent” \(doing\)/);
      return true;
    });
    assert.equal(db.select().from(schema.sessions).all().length, 0, "no session was born");
  });
});

// Slice 03's assertion.

const SERVER_SRC = fileURLToPath(new URL("../", import.meta.url));
const DRIZZLE = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const WEB_SRC = fileURLToPath(new URL("../../../web/src/", import.meta.url));
const COLUMN = /blockedByTaskId|blocked_by_task_id/;
/** Production sources: no tests, no stories (this file mentions the column to replay the migrations
 *  that added, copied and removed it). */
const sources = (root: string): string[] =>
  readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|stories)\.tsx?$/.test(f))
    .sort();
const citing = (root: string): string[] =>
  sources(root).filter((f) => COLUMN.test(readFileSync(join(root, f), "utf8")));

// Deliberate (structure work, "remove assertions on source text"): there
// is no rule to import here. The invariant is not a domain function's behaviour but the absence of a
// string across the repository (server, drizzle schema, screen). No call can prove a removed column
// is mentioned nowhere; only a text sweep can. So this stays a deliberate spelling test, unlike the
// ones the domain conversion removed.
describe("the column no longer exists: nobody mentions it, outside the migrations that added, copied and removed it", () => {
  it("server side, only migrations still mention it: they are history, not rewritten", () => {
    const outside = citing(SERVER_SRC).filter((f) => !f.startsWith("shared/migrations/"));
    assert.deepEqual(outside, [], "someone mentions a column that no longer exists");
    assert.ok(sources(SERVER_SRC).length > 0, "the sweep did read files");
  });

  it("the drizzle schema no longer declares it", () => {
    assert.deepEqual(citing(DRIZZLE), []);
    assert.ok(sources(DRIZZLE).length > 0, "the sweep did read files");
  });

  it("screen side, nobody: the task type carries blockedBy", () => {
    assert.deepEqual(citing(WEB_SRC), []);
    assert.ok(sources(WEB_SRC).length > 0, "the sweep did read files");
  });
});
