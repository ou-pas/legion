// A missing image offers its rebuild instead of looping (12/09).
//
// The defect: preflight refused, `runTask` failed the session, the task stayed `todo`, and
// `pumpQueue` sent it to the SAME machine thirty seconds later, forever.
//
// The six behaviours of the spec, in reading order: the queue skips, the question is ONE, the
// answer rebuilds without relaunching, the probe frees, the grace period escalates, the second
// choice parks.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-image-watch-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { runTask, pumpQueue } = await import("./manager.js");
const { wireFakeRunner, wireFakeDaemonProbe, wireFakeImageProbe } =
  await import("./test-wiring.js");
const { answerImageRebuild, sweepImageWaits } = await import("./image-watch.js");
type RebuildLaunchers = import("./image-watch.js").RebuildLaunchers;
const { clearImageWaits, IMAGE_WAIT_GRACE_MS } = await import("./image-wait.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
const { SESSION_IMAGE } = await import("../../infra/fleet-images.js");
const { listNotices } = await import("../../inbox/notices.js");
const { ON_ANSWER, INBOX_STATUS } = await import("../../inbox/inbox-enums.js");
const { imageRebuildTargetOf, IMAGE_REBUILD_CHOICE } = await import("../../inbox/image-rebuild.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "local";
const PROJECT_IMAGE = "project-x:latest";

type Spec = import("./types.js").SessionSpec;
let provisioned: Spec[] = [];
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned.push(spec);
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => {
  wireFakeRunner(null);
  wireFakeDaemonProbe(null);
  wireFakeImageProbe(null);
});

/** The pump launches fire-and-forget: without this flush the assertion runs before the refusal. */
const settle = () => new Promise((r) => setTimeout(r, 60));

function reset(taskIds: readonly string[], sessionImage: string | null = null): void {
  const now = new Date();
  clearImageWaits();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.notices).run();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "P", slug: "p", createdAt: now, sessionImage })
    .run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "agent", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners)
    .values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker, lastSeenAt: now })
    .run();
  for (const id of taskIds)
    db.insert(schema.tasks)
      .values({
        id,
        projectId: PROJECT,
        name: `task ${id}`,
        status: TASK_STATUS.todo,
        assigneeAgentId: AGENT,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  provisioned = [];
}

const sessions = () => db.select().from(schema.sessions).all();
const openQuestions = () =>
  db
    .select()
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.onAnswer, ON_ANSWER.rebuildImage))
    .all();
const taskStatus = (id: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()?.status;

/** Rebuilds that start nothing: only WHICH one is called is observed. */
function spyRebuilds(): { calls: string[]; deps: RebuildLaunchers } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      fleet: async (runnerId: string) => {
        calls.push(`fleet:${runnerId}`);
        return {
          ok: true as const,
          value: { runnerId, runnerName: RUNNER, targets: [], logPath: "/logs/rebuild.log" },
        };
      },
      project: async (projectId: string, runnerId: string) => {
        calls.push(`project:${projectId}:${runnerId}`);
        return {
          ok: true as const,
          value: {
            projectId,
            projectName: "P",
            runnerId,
            runnerName: RUNNER,
            tag: PROJECT_IMAGE,
            logPath: "/logs/project.log",
          },
        };
      },
    } as unknown as RebuildLaunchers,
  };
}

describe("a missing image opens a wait instead of a loop", () => {
  beforeEach(() => {
    reset(["t1"]);
    wireFakeDaemonProbe(async () => ({ ok: true }));
    wireFakeImageProbe(async () => ({ ok: false, why: "No such image" }));
  });

  it("the next queue round does NOT launch the task and creates no extra session", async () => {
    await assert.rejects(() => runTask("t1"));
    assert.equal(sessions().length, 1, "the first refusal did create (and fail) a session");

    pumpQueue();
    await settle();
    pumpQueue();
    await settle();

    assert.equal(sessions().length, 1, "the queue skipped the task: no extra session");
    assert.equal(provisioned.length, 0, "no container started");
  });

  it("five tasks that fell on the same machine and image produce ONE inbox entry", async () => {
    reset(["t1", "t2", "t3", "t4", "t5"]);
    for (const id of ["t1", "t2", "t3", "t4", "t5"]) await assert.rejects(() => runTask(id));

    await sweepImageWaits();
    await sweepImageWaits(); // a second round would not ask again

    const questions = openQuestions();
    assert.equal(questions.length, 1);
    const target = imageRebuildTargetOf(questions[0]!);
    assert.equal(target?.runnerId, RUNNER);
    assert.equal(target?.image, SESSION_IMAGE);
    assert.match(questions[0]!.body, /task t3/, "the question NAMES the held tasks");
  });

  it("rebuild starts the FLEET rebuild for a fleet image, without relaunching a session", async () => {
    await assert.rejects(() => runTask("t1"));
    const spy = spyRebuilds();

    await answerImageRebuild(
      { runnerId: RUNNER, runnerName: RUNNER, image: SESSION_IMAGE, projectId: PROJECT },
      IMAGE_REBUILD_CHOICE.rebuild,
      spy.deps,
    );
    await settle();

    assert.deepEqual(spy.calls, [`fleet:${RUNNER}`]);
    assert.equal(sessions().length, 1, "no session restarted right away");
    assert.equal(taskStatus("t1"), TASK_STATUS.todo, "the task stays queued, skipped");
  });

  it("rebuild starts the PROJECT rebuild when it is the image the project declares", async () => {
    reset(["t1"], PROJECT_IMAGE);
    wireFakeDaemonProbe(async () => ({ ok: true }));
    wireFakeImageProbe(async () => ({ ok: false, why: "No such image" }));
    await assert.rejects(() => runTask("t1"));
    const spy = spyRebuilds();

    await answerImageRebuild(
      { runnerId: RUNNER, runnerName: RUNNER, image: PROJECT_IMAGE, projectId: PROJECT },
      IMAGE_REBUILD_CHOICE.rebuild,
      spy.deps,
    );

    assert.deepEqual(spy.calls, [`project:${PROJECT}:${RUNNER}`]);
  });

  it("when the probe sees the image back, the queue picks the task up on the next round", async () => {
    await assert.rejects(() => runTask("t1"));
    await sweepImageWaits();
    assert.equal(openQuestions().length, 1);

    wireFakeImageProbe(async () => ({ ok: true }));
    const freed = await sweepImageWaits();
    assert.equal(freed, 1, "the wait is lifted by the PROBE");
    assert.equal(
      openQuestions()[0]?.status,
      INBOX_STATUS.closed,
      "the moot question is closed, not answered",
    );

    pumpQueue();
    await settle();

    assert.equal(provisioned.length, 1, "the task left on its own");
    assert.notEqual(taskStatus("t1"), TASK_STATUS.todo, "it left the queue");
  });

  it("fifteen minutes without the image: waiting tasks move to later, with a notice", async () => {
    reset(["t1", "t2"]);
    for (const id of ["t1", "t2"]) await assert.rejects(() => runTask(id));

    await sweepImageWaits(Date.now() + IMAGE_WAIT_GRACE_MS);

    assert.equal(taskStatus("t1"), TASK_STATUS.later);
    assert.equal(taskStatus("t2"), TASK_STATUS.later);
    const notice = listNotices().find((n) => /is still not on/.test(n.body));
    assert.ok(notice, "a notice names the machine and the image");
    assert.match(notice!.body, new RegExp(RUNNER));
    assert.match(notice!.body, /task t1/);
  });

  it("the second choice moves ALL tasks waiting for this image to later", async () => {
    reset(["t1", "t2", "t3"]);
    for (const id of ["t1", "t2", "t3"]) await assert.rejects(() => runTask(id));
    const spy = spyRebuilds();

    await answerImageRebuild(
      { runnerId: RUNNER, runnerName: RUNNER, image: SESSION_IMAGE, projectId: PROJECT },
      IMAGE_REBUILD_CHOICE.park,
      spy.deps,
    );

    assert.deepEqual(spy.calls, [], "parking rebuilds nothing");
    for (const id of ["t1", "t2", "t3"]) assert.equal(taskStatus(id), TASK_STATUS.later);

    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 0, "later does not restart on its own");
  });
});
