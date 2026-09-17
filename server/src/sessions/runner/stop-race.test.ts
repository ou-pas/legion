// A requested stop is not overtaken by the container's exit (05/09).
//
// `stopSession` destroyed BEFORE writing its state. While destroying meant `docker rm -f` nothing
// could slip in between; since destruction asks for a CLEAN stop and gives the runtime thirty
// seconds to push, `docker wait` returns during that delay (the runtime exits 0, having honoured
// its SIGTERM). `runLifecycle` then read a still-`running` session, marked it `destroyed` and called
// `settleTaskAfterSession`; `stopSession`'s `WHERE status = 'doing'`, arriving after, matched
// nothing, and the stop came out as an agent that settled itself.
//
// The proof holds destruction OPEN while the container exit arrives: exactly the defect's window,
// too short to observe on a real docker. Nothing is spawned; the runner is injected
// (`wireFakeRunner`), the SAME one `stopSession` builds, since both go through that hook.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-stop-race-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { runLifecycle, stopSession } = await import("./manager.js");
const { wireFakeRunner } = await import("./test-wiring.js");
const { SETTLED, TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
const { SESSION_STATUS } = await import("../session-terminal.js");

type Spec = import("./types.js").SessionSpec;
type Runner = import("./types.js").Runner;

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";
const SESSION = "s1";
const TASK = "t1";

after(() => wireFakeRunner(null));

function reset(): void {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker }).run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "task",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: SESSION_STATUS.starting,
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

/** The racing runner: its destruction returns only when the test decides, and the container exit
 *  arrives DURING it. One instance serves both callers. */
function racingRunner() {
  let exit: (r: { exitCode: number }) => void = () => {};
  let release: () => void = () => {};
  const exited = new Promise<{ exitCode: number }>((r) => {
    exit = r;
  });
  const destroyed = new Promise<void>((r) => {
    release = r;
  });
  let destroys = 0;
  const runner: Runner = {
    kind: RUNNER_KIND.docker,
    provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
    wait: () => exited,
    destroy: async () => {
      destroys++;
      await destroyed;
    },
  };
  wireFakeRunner(() => runner);
  return { runner, exit, release, destroys: () => destroys };
}

/** Minimal spec: `runLifecycle` only reads the network mode and `mock`. */
const spec = (): Spec => ({ network: { mode: "open" }, mock: true }) as unknown as Spec;

/** Lets the event loop run: `runLifecycle` and `stopSession` are in flight. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const sessionRow = () =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, SESSION)).get();
const taskRow = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, TASK)).get();
/** END events published on the session: a stop produces only one. */
const terminalEvents = () =>
  db
    .select()
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, SESSION))
    .all()
    .filter((e) => e.type === "status")
    .map((e) => JSON.parse(e.payload) as { status?: string; reason?: string; stopped?: boolean })
    .filter((p) => p.status === SESSION_STATUS.failed || p.status === SESSION_STATUS.destroyed);

describe("stopSession: state is written before destruction", () => {
  beforeEach(() => reset());

  it("the container exits during the clean stop: the session stays `failed`/stopped, the task `review`/stopped", async () => {
    const r = racingRunner();
    const life = runLifecycle(SESSION, TASK, r.runner, spec());
    await settle(); // the session is `running` and awaits the container exit

    const stop = stopSession(SESSION);
    await settle(); // `stopSession` wrote its state and now awaits destruction

    // The defect's window: the runtime honoured its SIGTERM, pushed its work and returned 0 while
    // destruction is still running.
    r.exit({ exitCode: 0 });
    await settle();
    r.release();
    await Promise.all([life, stop]);

    const s = sessionRow();
    assert.equal(s?.status, SESSION_STATUS.failed);
    assert.match(s?.endReason ?? "", /stopped by the operator/);
    const t = taskRow();
    assert.equal(t?.status, TASK_STATUS.review);
    assert.equal(
      t?.settledOutcome,
      SETTLED.stopped,
      "an exit 0 arriving meanwhile must not erase the outcome",
    );
  });

  it("a single terminal write, the stop's: `runLifecycle` does not go over it", async () => {
    const r = racingRunner();
    const life = runLifecycle(SESSION, TASK, r.runner, spec());
    await settle();

    const stop = stopSession(SESSION);
    await settle();
    r.exit({ exitCode: 0 });
    await settle();
    r.release();
    await Promise.all([life, stop]);

    const ends = terminalEvents();
    assert.equal(ends.length, 1, `two ends published for one stop: ${JSON.stringify(ends)}`);
    assert.equal(
      ends[0]?.stopped,
      true,
      "the published end must be the stop's, not the exit code's",
    );
  });

  it("the open inbox question is closed, even if destruction drags", async () => {
    const r = racingRunner();
    db.insert(schema.inboxMessages)
      .values({
        id: "im-1",
        sessionId: SESSION,
        taskId: TASK,
        agentId: AGENT,
        kind: "text",
        body: "?",
        status: "open",
        createdAt: new Date(),
      })
      .run();
    const life = runLifecycle(SESSION, TASK, r.runner, spec());
    await settle();

    const stop = stopSession(SESSION);
    await settle();
    // Before destruction even returns: that is what "state first" promises.
    assert.equal(
      db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, "im-1")).get()
        ?.status,
      "closed",
    );

    r.exit({ exitCode: 0 });
    r.release();
    await Promise.all([life, stop]);
  });
});
