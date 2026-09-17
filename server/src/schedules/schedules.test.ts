// The tick runs agents on its own, so it deserves the most tests. Real database in a temp file:
// the read crosses schedules / schedule_runs / tasks, and an in-memory fake would prove nothing
// about foreign keys or write order.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-schedules-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  createSchedule,
  deleteSchedule,
  fireDueSchedules,
  listRuns,
  listSchedules,
  makeCreateTask,
  MISS_AFTER_MS,
  updateSchedule,
  validateSchedule,
} = await import("./schedules.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

const P = "p-sched",
  A = "a-sched";
const NOW = new Date("2026-08-26T08:00:00Z");
const ms = (iso: string) => new Date(iso).getTime();

beforeEach(() => {
  db.delete(schema.scheduleRuns).run();
  db.delete(schema.schedules).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: P, name: "Legion", slug: "legion", createdAt: NOW })
    .run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "watcher", rolePrompt: "r", createdAt: NOW })
    .run();
});

const ok = (body: Parameters<typeof validateSchedule>[0]) => {
  const v = validateSchedule(body);
  assert.ok(v.ok, `expected valid: ${v.ok ? "" : v.error}`);
  return v.value;
};

describe("validating a schedule", () => {
  it("the minimum: a name, a cron, an agent", () => {
    const v = ok({ name: "Morning watch", cron: "0 7 * * 1-5", agentId: A });
    assert.equal(v.cron, "0 7 * * 1-5");
    assert.equal(v.enabled, true);
  });

  it("an unreadable expression is REFUSED at the door", () => {
    // A stored invalid cron would fail later, in a tick nobody watches.
    const v = validateSchedule({ name: "x", cron: "@daily", agentId: A });
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.error, /five-field UTC cron/);
  });

  it("an agent OR a chain, never both, never neither", () => {
    assert.equal(
      validateSchedule({ name: "x", cron: "* * * * *", agentId: A, templateId: "t" }).ok,
      false,
    );
    assert.equal(validateSchedule({ name: "x", cron: "* * * * *" }).ok, false);
  });

  it("a scheduled chain needs a request", () => {
    assert.equal(validateSchedule({ name: "x", cron: "* * * * *", templateId: "t" }).ok, false);
    assert.equal(
      validateSchedule({ name: "x", cron: "* * * * *", templateId: "t", prompt: "go" }).ok,
      true,
    );
  });

  it("a partial PATCH does not erase what it does not carry", () => {
    const base = ok({ name: "Watch", cron: "0 7 * * *", agentId: A });
    const v = validateSchedule({ enabled: false }, base);
    assert.ok(v.ok);
    assert.equal(v.value.cron, "0 7 * * *");
    assert.equal(v.value.name, "Watch");
    assert.equal(v.value.enabled, false);
  });
});

describe("the next due time is COMPUTED on write", () => {
  it("set on creation", () => {
    const s = createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    assert.equal(s.nextRunAt, ms("2026-08-26T09:00:00Z"));
  });

  it("recomputed when the cron changes", () => {
    const s = createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    const u = updateSchedule(s.id, ok({ name: "Watch", cron: "30 10 * * *", agentId: A }), NOW);
    assert.equal(u.nextRunAt, ms("2026-08-26T10:30:00Z"));
  });

  it("CLEARED when the rule is disabled: the tick reads only this field", () => {
    const s = createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    const off = updateSchedule(
      s.id,
      ok({ name: "Watch", cron: "0 9 * * *", agentId: A, enabled: false }),
      NOW,
    );
    assert.equal(off.nextRunAt, null);
    const on = updateSchedule(
      s.id,
      ok({ name: "Watch", cron: "0 9 * * *", agentId: A, enabled: true }),
      NOW,
    );
    assert.equal(on.nextRunAt, ms("2026-08-26T09:00:00Z"));
  });

  it("null when the due time never comes", () => {
    const s = createSchedule(P, ok({ name: "30 February", cron: "0 0 30 2 *", agentId: A }), NOW);
    assert.equal(s.nextRunAt, null);
  });
});

describe("the tick", () => {
  const deps = {
    createTask: makeCreateTask(() => ({ ok: true, value: { runId: "r", taskIds: ["t-chain"] } })),
  };

  it("does nothing until the time has come", () => {
    createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    assert.equal(fireDueSchedules(ms("2026-08-26T08:59:00Z"), deps), 0);
  });

  it("creates the task, assigns it to the agent, and leaves a trace", () => {
    const s = createSchedule(P, ok({ name: "Morning watch", cron: "0 9 * * *", agentId: A }), NOW);
    assert.equal(fireDueSchedules(ms("2026-08-26T09:00:10Z"), deps), 1);

    const tasks = db.select().from(schema.tasks).all();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.name, "Morning watch");
    assert.equal(tasks[0]!.assigneeAgentId, A);
    // `todo` and nothing else: the schedule queues work, the pump decides when it starts. A launch
    // path of its own would bypass the session cap.
    assert.equal(tasks[0]!.status, TASK_STATUS.todo);

    const runs = listRuns(s.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.outcome, "task-created");
    assert.equal(runs[0]!.taskId, tasks[0]!.id);
    // The trace time is the PLANNED time, not the tick that noticed it.
    assert.equal(runs[0]!.firedAt, ms("2026-08-26T09:00:00Z"));

    const after = listSchedules(P)[0]!;
    assert.equal(after.lastRunAt, ms("2026-08-26T09:00:10Z"));
    assert.equal(after.nextRunAt, ms("2026-08-27T09:00:00Z"));
  });

  it("does not rerun the same due time on the next tick", () => {
    createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    fireDueSchedules(ms("2026-08-26T09:00:10Z"), deps);
    assert.equal(fireDueSchedules(ms("2026-08-26T09:00:40Z"), deps), 0);
    assert.equal(db.select().from(schema.tasks).all().length, 1);
  });

  it("A MISSED DUE TIME IS NOT CAUGHT UP", () => {
    // The server was off all night. Catching up would now run what was meant for 9:00, on a
    // database and repositories that have moved since.
    const s = createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    const late = ms("2026-08-26T09:00:00Z") + MISS_AFTER_MS + 60_000;
    assert.equal(fireDueSchedules(late, deps), 1);
    assert.equal(db.select().from(schema.tasks).all().length, 0);
    assert.equal(listRuns(s.id)[0]!.outcome, "skipped-missed");
    // And it restarts from the NEXT one, or it would stay due forever.
    assert.equal(listSchedules(P)[0]!.nextRunAt, ms("2026-08-27T09:00:00Z"));
  });

  it("a short delay is still honoured", () => {
    createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    fireDueSchedules(ms("2026-08-26T09:00:00Z") + MISS_AFTER_MS - 1_000, deps);
    assert.equal(db.select().from(schema.tasks).all().length, 1);
  });

  it("an error leaves a trace AND advances the rule", () => {
    // Without advancing, the same error would be written every thirty seconds forever, and the
    // trace would stop saying what happened.
    const s = createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    const boom = {
      createTask: () => {
        throw new Error("agent deleted");
      },
    };
    assert.equal(fireDueSchedules(ms("2026-08-26T09:00:10Z"), boom), 1);
    const run = listRuns(s.id)[0]!;
    assert.equal(run.outcome, "error");
    assert.match(run.reason ?? "", /agent deleted/);
    assert.equal(listSchedules(P)[0]!.nextRunAt, ms("2026-08-27T09:00:00Z"));
    // A rule in error did NOT run: `lastRunAt` does not move.
    assert.equal(listSchedules(P)[0]!.lastRunAt, null);
  });

  it("a scheduled chain goes through template instantiation", () => {
    const s = createSchedule(
      P,
      ok({
        name: "Weekly review",
        cron: "0 9 * * 1",
        templateId: "tpl-1",
        prompt: "do the review",
      }),
      NOW,
    );
    let seen: [string, string] | null = null;
    fireDueSchedules(ms("2026-08-31T09:00:10Z"), {
      createTask: makeCreateTask((id, req) => {
        seen = [id, req];
        return { ok: true, value: { runId: "r", taskIds: ["t-1"] } };
      }),
    });
    assert.deepEqual(seen, ["tpl-1", "do the review"]);
    assert.equal(listRuns(s.id)[0]!.taskId, "t-1");
  });

  it("deleting a schedule takes its trace with it", () => {
    const s = createSchedule(P, ok({ name: "Watch", cron: "0 9 * * *", agentId: A }), NOW);
    fireDueSchedules(ms("2026-08-26T09:00:10Z"), deps);
    deleteSchedule(s.id);
    assert.equal(listSchedules(P).length, 0);
    assert.equal(db.select().from(schema.scheduleRuns).all().length, 0);
  });
});
