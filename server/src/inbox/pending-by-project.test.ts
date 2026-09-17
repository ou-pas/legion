// Pending count per project (slice nav/02, AC#2): the rail badge counts only what stops someone.
// Three traps (an answered entry, a notice, a review task without a gate) must stay out.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { InboxStatus } from "./inbox-enums.js";

const dir = mkdtempSync(join(tmpdir(), "legion-pending-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { countPendingByProject, pendingByProject } = await import("./pending-by-project.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_KIND } = await import("./inbox-enums.js");
const { INBOX_STATUS } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

describe("countPendingByProject, pure", () => {
  it("counts an open entry and a gate without deduplicating them", () => {
    const counts = countPendingByProject(
      ["p1"],
      [{ projectId: "p1", waitForTaskId: null, wakeAt: null }],
      ["p1"],
    );
    assert.equal(counts.p1, 2);
  });

  it("does not count a self-waking wait (task or time)", () => {
    const counts = countPendingByProject(
      ["p1"],
      [
        { projectId: "p1", waitForTaskId: "t-target", wakeAt: null },
        { projectId: "p1", waitForTaskId: null, wakeAt: new Date() },
      ],
      [],
    );
    assert.equal(counts.p1, 0);
  });

  it("is zero for a project with nothing pending, which is still listed", () => {
    const counts = countPendingByProject(["quiet"], [], []);
    assert.equal(counts.quiet, 0);
    assert.ok("quiet" in counts);
  });
});

const now = new Date();

/** An empty project with its agent, named so counts read unambiguously. */
function seedProject(id: string) {
  db.insert(schema.projects).values({ id, name: id, slug: id, createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: `a-${id}`, projectId: id, name: `a-${id}`, rolePrompt: "r", createdAt: now })
    .run();
  return id;
}

function seedTask(
  id: string,
  projectId: string,
  over: Partial<typeof schema.tasks.$inferInsert> = {},
) {
  db.insert(schema.tasks)
    .values({ id, projectId, name: id, createdAt: now, updatedAt: now, ...over })
    .run();
  return id;
}

/** An inbox entry needs a session, which needs a runner: foreign keys are on. */
function seedOpenAsk(
  id: string,
  taskId: string,
  projectId: string,
  status: InboxStatus,
  over: { waitForTaskId?: string; wakeAt?: Date } = {},
) {
  db.insert(schema.sessions)
    .values({
      id: `s-${id}`,
      taskId,
      agentId: `a-${projectId}`,
      runnerId: RUNNER,
      model: "haiku",
      callbackToken: `t-${id}`,
      startedAt: now,
    })
    .run();
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId: `s-${id}`,
      taskId,
      agentId: `a-${projectId}`,
      kind: INBOX_KIND.text,
      body: "?",
      status,
      createdAt: now,
      ...over,
    })
    .run();
}

const RUNNER = "r-nav02";
db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker }).run();

const STOPPED = seedProject("stopped");
const QUIET = seedProject("quiet");

it("counts only open inbox entries and gated tasks in review", () => {
  seedOpenAsk("i1", seedTask("t1", STOPPED), STOPPED, INBOX_STATUS.open);
  seedTask("t2", STOPPED, { approvalGate: true, status: TASK_STATUS.review });

  // The three traps: an answered question, a notice, a review without a gate.
  seedOpenAsk("i2", seedTask("t3", STOPPED), STOPPED, INBOX_STATUS.answered);
  db.insert(schema.notices)
    .values({ id: "n1", kind: "info", body: "standup", read: false, createdAt: now })
    .run();
  seedTask("t4", STOPPED, { status: TASK_STATUS.review });

  assert.equal(pendingByProject()[STOPPED], 2);
});

it("is zero for a project with nothing pending, which is still listed", () => {
  const counts = pendingByProject();
  assert.equal(counts[QUIET], 0);
  assert.ok(QUIET in counts, "a project with nothing pending must appear, or it reads as unknown");
});

it("does not count a self-waking wait (slice nav/11)", () => {
  const SLEEPING = seedProject("sleeping");
  const target = seedTask("t-target", SLEEPING);
  seedOpenAsk("i-dep", seedTask("t5", SLEEPING), SLEEPING, INBOX_STATUS.open, {
    waitForTaskId: target,
  });
  seedOpenAsk("i-quota", seedTask("t6", SLEEPING), SLEEPING, INBOX_STATUS.open, {
    wakeAt: new Date(Date.now() + 60_000),
  });
  assert.equal(pendingByProject()[SLEEPING], 0, "neither stops anyone");

  // Counter-check: a real question on the same project counts.
  seedOpenAsk("i-real", seedTask("t7", SLEEPING), SLEEPING, INBOX_STATUS.open);
  assert.equal(pendingByProject()[SLEEPING], 1);
});
