// Preflight refuses a launch when the session image is missing from the runner (08/09).
// Incident and reasoning in image-preflight.ts: two tasks from two projects died on the "local"
// runner with "docker run failed: No such image: legion-session:latest".
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-image-preflight-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { runTask } = await import("./manager.js");
const { wireFakeRunner, wireFakeDaemonProbe, wireFakeImageProbe } =
  await import("./test-wiring.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
const { SESSION_IMAGE } = await import("../../infra/fleet-images.js");
const { latestImageVerdict, resetImageVerdictStoreForTests } =
  await import("../../infra/images/verdict-store.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "local";

type Spec = import("./types.js").SessionSpec;
let provisioned: Spec | null = null;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned = spec;
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

function reset(sessionImage: string | null = null): void {
  const now = new Date();
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
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: PROJECT,
      name: "task t1",
      status: TASK_STATUS.todo,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  provisioned = null;
}

const session = () =>
  db.select().from(schema.sessions).where(eq(schema.sessions.taskId, "t1")).get();

describe("preflight refuses a launch when the session image is missing from the runner", () => {
  beforeEach(() => {
    reset();
    resetImageVerdictStoreForTests();
    wireFakeDaemonProbe(async () => ({ ok: true }));
  });

  it("`docker image inspect` fails: the launch is refused, and the refusal names the runner and the image", async () => {
    let calledWith: [string | null, string] | null = null;
    wireFakeImageProbe(async (dockerHost, image) => {
      calledWith = [dockerHost, image];
      return { ok: false, why: "No such image: legion-session:latest" };
    });

    await assert.rejects(
      () => runTask("t1"),
      (err: Error) => {
        assert.match(err.message, /Session image/);
        assert.match(err.message, new RegExp(RUNNER));
        assert.match(err.message, /legion-session:latest/);
        assert.match(err.message, /No such image/);
        return true;
      },
    );

    assert.ok(calledWith, "the image probe was called");
    assert.equal(
      calledWith![1],
      SESSION_IMAGE,
      "the default tag, since the project names no image",
    );

    const s = session();
    assert.equal(s?.status, "failed");
    assert.match(s?.endReason ?? "", /Session image/);
  });

  it("the reserved slot is released on an image refusal, as on a disk refusal", async () => {
    wireFakeImageProbe(async () => ({ ok: false, why: "No such image" }));

    await assert.rejects(() => runTask("t1"));

    assert.equal(session()?.status, "failed", "the session exists but no longer holds a slot");
    assert.equal(
      provisioned,
      null,
      "the runner never received a spec, the container does not start",
    );
  });

  it("the refusal lands in the task trace (control_events, level warn, source preflight)", async () => {
    wireFakeImageProbe(async () => ({ ok: false, why: "No such image" }));
    const { listControlEvents } = await import("../../shared/db.js");

    await assert.rejects(() => runTask("t1"));

    const events = listControlEvents({ limit: 20 });
    const found = events.find((e) => e.source === "preflight" && /Session image/.test(e.message));
    assert.ok(found, "a control event names the refusal");
    assert.equal(found?.level, "warn");
  });

  it("a present image refuses nothing: the session starts", async () => {
    wireFakeImageProbe(async () => ({ ok: true }));

    await runTask("t1");
    await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget

    assert.ok(provisioned, "the fake runner received a spec, nothing blocked");
    assert.notEqual(session()?.status, "failed", "preflight refused nothing");
  });

  it("the probed image is the PROJECT one, not the default tag, when the project names one", async () => {
    reset("legion-session:custom-project");
    wireFakeDaemonProbe(async () => ({ ok: true }));
    let calledImage: string | null = null;
    wireFakeImageProbe(async (_dockerHost, image) => {
      calledImage = image;
      return { ok: true };
    });

    await runTask("t1");
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(calledImage, "legion-session:custom-project");
    assert.notEqual(calledImage, SESSION_IMAGE);
  });

  it("the probe verdict is remembered for the NEXT runner choice (12/09)", async () => {
    wireFakeImageProbe(async () => ({ ok: false, why: "No such image" }));

    await assert.rejects(() => runTask("t1"));

    const v = latestImageVerdict(RUNNER, SESSION_IMAGE);
    assert.equal(v?.ok, false);
    assert.equal(v?.why, "No such image");
  });
});
