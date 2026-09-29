// The orchestration: does a tick call the right things, in the right order, with the right
// arguments, and persist what happened. The forge and `fixCi` are injected (`CiWatchDeps`), same
// choice as `merge-events.test.ts`'s `HandleDeps`: a database is cheap to fake in a tmp file, a
// forge and a running session are not. The judgement itself (what a state means) is
// `ci-watch.test.ts`, without either.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Result } from "../http/from-result.js";

const dir = mkdtempSync(join(tmpdir(), "legion-ci-watch-tick-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { ciWatchTick } = await import("./ci-watch-tick.js");
const { ciWatchStateRow } = await import("./ci-watch-store.js");
const { taskActivityOf } = await import("./merge-events-store.js");
const { CHECK_STATE } = await import("../integrations/forge.js");
const { CI_WATCH_CAP } = await import("./ci-watch.js");

const PROJECT = "p1";
const TASK = "t1";
const REPO = "backend";
const NUMBER = 42;
const now = new Date();

before(() => {
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "Fix the parser",
      description: "",
      status: "review",
      prUrls: JSON.stringify([{ repo: REPO, url: `https://github.com/o/r/pull/${NUMBER}` }]),
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

beforeEach(() => {
  db.delete(schema.ciWatchState).run();
  db.delete(schema.taskActivity).run();
});

/** A single-PR merge state, the shape `mergeStatesOf` returns for one open change request. */
function oneState(checkState: (typeof CHECK_STATE)[keyof typeof CHECK_STATE]) {
  return [
    {
      repo: REPO,
      url: `https://github.com/o/r/pull/${NUMBER}`,
      number: NUMBER,
      mergeState: "mergeable" as const,
      prState: "open" as const,
      checkState,
    },
  ];
}

const okFix: Result<{ launched: string }> = { ok: true, value: { launched: "session-1" } };
const refusedFix: Result<{ launched: string }> = { ok: false, status: 409, error: "session active" };

describe("ciWatchTick", () => {
  it("red CI launches fixCi, counts the attempt, writes one activity line", async () => {
    const calls: unknown[] = [];
    await ciWatchTick({
      merge: async () => oneState(CHECK_STATE.failing),
      fixCi: async (taskId, target) => {
        calls.push([taskId, target]);
        return okFix;
      },
      notifyOut: () => assert.fail("must not notify before the cap is spent"),
    });
    assert.deepEqual(calls, [[TASK, { repoName: REPO, number: NUMBER }]]);
    assert.deepEqual(ciWatchStateRow(TASK, REPO, NUMBER), { attempts: 1, notified: false });
    const activity = taskActivityOf(TASK);
    assert.equal(activity.length, 1);
    assert.equal(activity[0]?.body, "CI red on backend#42, automatic attempt 1/3");
    assert.equal(activity[0]?.from, "system");
  });

  it("a fixCi refusal does not count as an attempt — retried next tick, no activity line", async () => {
    let calls = 0;
    const tick = () =>
      ciWatchTick({
        merge: async () => oneState(CHECK_STATE.failing),
        fixCi: async () => {
          calls++;
          return refusedFix;
        },
        notifyOut: () => assert.fail("must not notify on a mere refusal"),
      });
    await tick();
    await tick();
    assert.equal(calls, 2, "fixCi is retried every tick while it keeps refusing");
    assert.equal(ciWatchStateRow(TASK, REPO, NUMBER), null, "no counter ever written");
    assert.equal(taskActivityOf(TASK).length, 0);
  });

  it("notifies exactly once once the cap is spent, never again on the next red tick", async () => {
    const now2 = new Date();
    db.insert(schema.ciWatchState)
      .values({
        taskId: TASK,
        repoName: REPO,
        number: NUMBER,
        attempts: CI_WATCH_CAP,
        notified: false,
        updatedAt: now2,
      })
      .run();
    let notified = 0;
    const tick = () =>
      ciWatchTick({
        merge: async () => oneState(CHECK_STATE.failing),
        fixCi: async () => assert.fail("the cap is spent — fixCi must not be called again"),
        notifyOut: (event, payload) => {
          notified++;
          assert.equal(event, "ci_failed");
          assert.equal(payload.taskId, TASK);
          assert.equal(payload.task, "Fix the parser");
        },
      });
    await tick();
    assert.equal(notified, 1);
    assert.deepEqual(ciWatchStateRow(TASK, REPO, NUMBER), { attempts: CI_WATCH_CAP, notified: true });
    await tick(); // second tick, still red: no second notification
    assert.equal(notified, 1);
  });

  it("green resets the counter", async () => {
    db.insert(schema.ciWatchState)
      .values({ taskId: TASK, repoName: REPO, number: NUMBER, attempts: 2, notified: false, updatedAt: now })
      .run();
    await ciWatchTick({
      merge: async () => oneState(CHECK_STATE.passing),
      fixCi: async () => assert.fail("green — nothing to fix"),
      notifyOut: () => assert.fail("green — nothing to notify"),
    });
    assert.deepEqual(ciWatchStateRow(TASK, REPO, NUMBER), { attempts: 0, notified: false });
  });

  it("pending and unknown do nothing", async () => {
    for (const checkState of [CHECK_STATE.pending, CHECK_STATE.unknown]) {
      await ciWatchTick({
        merge: async () => oneState(checkState),
        fixCi: async () => assert.fail(`${checkState} — never act on uncertainty`),
        notifyOut: () => assert.fail(`${checkState} — never act on uncertainty`),
      });
      assert.equal(ciWatchStateRow(TASK, REPO, NUMBER), null);
    }
  });

  it("switch off, demo project and non-review tasks never reach the forge probe", async () => {
    const off = "p-off";
    const demo = "p-demo";
    db.insert(schema.projects)
      .values([
        { id: off, name: "Off", slug: "off-p", ciWatch: false, createdAt: now },
        { id: demo, name: "Demo", slug: "demo-p", demo: true, createdAt: now },
      ])
      .run();
    db.insert(schema.tasks)
      .values([
        {
          id: "t-off",
          projectId: off,
          name: "off",
          description: "",
          status: "review",
          prUrls: "[]",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "t-demo",
          projectId: demo,
          name: "demo",
          description: "",
          status: "review",
          prUrls: "[]",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "t-todo",
          projectId: PROJECT,
          name: "todo",
          description: "",
          status: "todo",
          prUrls: JSON.stringify([{ repo: REPO, url: `https://github.com/o/r/pull/${NUMBER}` }]),
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
    const probedProjects: string[] = [];
    await ciWatchTick({
      merge: async (projectId, prs) => {
        probedProjects.push(projectId);
        return prs.length ? oneState(CHECK_STATE.failing) : [];
      },
      // The watched project's own review task (seeded in `before`) legitimately reaches fixCi; only
      // the excluded ones must never get here.
      fixCi: async () => okFix,
      notifyOut: () => {},
    });
    // Neither the switched-off nor the demo project is probed, and the `todo` task in the watched
    // project is not a candidate either — only the watched project's review task is.
    assert.deepEqual(probedProjects, [PROJECT]);
  });
});
