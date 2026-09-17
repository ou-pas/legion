// The shared browser (QHHXj9Q5MI, v30, 23/08):
//
//  1. Nothing by default: without the `browserAccess` grant the spec carries neither endpoint nor
//     browser network; the agent cannot even know the service exists.
//  2. The grant is not enough: a process runner has no docker network to offer, so the session
//     starts without a browser and without an error (degrade, never block).
//  3. The service is idempotent: already running → no docker run; stopped → replaced; existing
//     network → tolerated. The network creation MUST carry `--internal`: it is the egress wall.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-browser-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema, listControlEvents } = await import("../../shared/db.js");
const { browserNames, browserEndpoint, wsEndpoint, ensureBrowserService, stopBrowserService } =
  await import("./browser-service.js");
const { browserForSession, runTask } = await import("./manager.js");
const { wireFakeRunner } = await import("./test-wiring.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

type ExecResult = { code: number; stdout: string; stderr: string };

/** Fake docker: replays scripted answers and records every command. */
function fakeExec(script: (args: string[]) => ExecResult) {
  const calls: string[][] = [];
  const exec = (args: string[], _host: string | null): Promise<ExecResult> => {
    calls.push(args);
    return Promise.resolve(script(args));
  };
  return { exec, calls };
}

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const ko = (stderr: string): ExecResult => ({ code: 1, stdout: "", stderr });

describe("browserNames / endpoints: names derive from the RUNNER, not the session", () => {
  it("container and network carry the runner id", () => {
    assert.deepEqual(browserNames("r1"), {
      container: "legion-browser-r1",
      network: "legion-browser-net-r1",
    });
  });
  it("the endpoint targets the container by its docker name (internal DNS)", () => {
    assert.equal(browserEndpoint("r1"), "ws://legion-browser-r1:3000/");
    assert.equal(wsEndpoint("legion-browser-r1"), "ws://legion-browser-r1:3000/");
  });
});

describe("ensureBrowserService: idempotent, and the network is ALWAYS --internal", () => {
  const target = { container: "legion-browser-r1", network: "legion-browser-net-r1" };

  it("first start: internal network created, then container started on THAT network", async () => {
    const { exec, calls } = fakeExec((args) =>
      args[0] === "inspect" ? ko("No such object") : ok("abc123"),
    );
    await ensureBrowserService(target, null, exec);
    assert.deepEqual(calls[0], ["network", "create", "--internal", "legion-browser-net-r1"]);
    const run = calls.find((c) => c[0] === "run");
    assert.ok(run, "docker run issued");
    assert.equal(run[run.indexOf("--network") + 1], "legion-browser-net-r1");
    assert.ok(run.includes("--init"), "--init: Playwright forks, zombies must be reaped");
  });

  it("service already running: NO docker run", async () => {
    const { exec, calls } = fakeExec((args) =>
      args[0] === "network"
        ? ko("network with name legion-browser-net-r1 already exists")
        : args[0] === "inspect"
          ? ok("true\n")
          : ok(),
    );
    await ensureBrowserService(target, null, exec);
    assert.ok(!calls.some((c) => c[0] === "run"), "a live service is not restarted");
  });

  it("stopped container (reboot, OOM): rm -f then restart, the service is stateless", async () => {
    const { exec, calls } = fakeExec((args) =>
      args[0] === "inspect" ? ok("false\n") : ok("abc123"),
    );
    await ensureBrowserService(target, null, exec);
    const order = calls.map((c) => c[0]);
    assert.ok(order.indexOf("rm") < order.indexOf("run"), "rm before run");
  });

  // The 04/09 task scenario: the container is already running (`docker run` pins the image at
  // start), but `make image-browser` has since rebuilt the tag; the service kept running the old
  // version, and nothing said so before a session's `428`.
  function driftScript(opts: {
    runningVersion: string;
    currentVersion: string;
    runningId?: string;
    currentId?: string;
  }) {
    const {
      runningVersion,
      currentVersion,
      runningId = "sha256:old",
      currentId = "sha256:new",
    } = opts;
    return (args: string[]): ExecResult => {
      if (args[0] === "network")
        return ko("network with name legion-browser-net-r1 already exists");
      if (args[0] === "inspect" && args[2] === "{{.State.Running}}") return ok("true\n");
      if (args[0] === "inspect") return ok(`${runningId}|${runningVersion}`);
      if (args[0] === "image") return ok(`${currentId}|${currentVersion}`);
      return ok("newcontainerid");
    };
  }

  it("running container on a stale image: automatic restart, without waiting for a session's 428", async () => {
    const { exec, calls } = fakeExec(
      driftScript({ runningVersion: "1.49.1", currentVersion: "1.62.1" }),
    );
    await ensureBrowserService(target, null, exec);
    const order = calls.map((c) => c[0]);
    assert.ok(order.includes("rm"), "the stale container is removed");
    assert.ok(order.includes("run"), "…then restarted: stateless, restarting loses nothing");
    assert.ok(order.indexOf("rm") < order.indexOf("run"), "rm before run");

    const [event] = listControlEvents({ level: "warn" });
    assert.ok(event, "the restart is logged in control_events");
    assert.match(event.message, /1\.49\.1/);
    assert.match(event.message, /1\.62\.1/);
    assert.equal(event.source, "browser");
  });

  it("running container, SAME image: no restart (image ids match)", async () => {
    const { exec, calls } = fakeExec(
      driftScript({
        runningVersion: "1.62.1",
        currentVersion: "1.62.1",
        runningId: "sha256:same",
        currentId: "sha256:same",
      }),
    );
    await ensureBrowserService(target, null, exec);
    assert.ok(!calls.some((c) => c[0] === "run"), "same image: no restart");
    assert.ok(!calls.some((c) => c[0] === "rm"), "same image: no removal");
  });

  it("one of the two inspections fails: no proof, no accusation, service left as is", async () => {
    const { exec, calls } = fakeExec((args) => {
      if (args[0] === "network")
        return ko("network with name legion-browser-net-r1 already exists");
      if (args[0] === "inspect" && args[2] === "{{.State.Running}}") return ok("true\n");
      if (args[0] === "inspect") return ok("sha256:old|1.49.1");
      if (args[0] === "image") return ko("no such image"); // e.g. image removed between the two reads
      return ok();
    });
    await ensureBrowserService(target, null, exec);
    assert.ok(!calls.some((c) => c[0] === "run"), "no proof: the running service is not touched");
    assert.ok(!calls.some((c) => c[0] === "rm"), "no proof: nothing is removed");
  });

  it("docker run failure: named error (provisioning degrades, not here)", async () => {
    const { exec } = fakeExec((args) =>
      args[0] === "run" ? ko("no such image") : args[0] === "inspect" ? ko("no") : ok(),
    );
    await assert.rejects(() => ensureBrowserService(target, null, exec), /browser run failed/);
  });

  it("stopBrowserService removes the container then the network", async () => {
    const { exec, calls } = fakeExec(() => ok());
    await stopBrowserService("r1", null, exec);
    assert.deepEqual(calls[0], ["rm", "-f", "legion-browser-r1"]);
    assert.deepEqual(calls[1], ["network", "rm", "legion-browser-net-r1"]);
  });
});

describe("browserForSession: the grant AND a docker runner, otherwise nothing", () => {
  it("grant + docker → the runner's service and network", () => {
    assert.deepEqual(
      browserForSession({ browserAccess: true }, { id: "r1", kind: RUNNER_KIND.docker }),
      {
        service: "legion-browser-r1",
        network: "legion-browser-net-r1",
      },
    );
  });
  it("no grant → null, even on docker", () => {
    assert.equal(
      browserForSession({ browserAccess: false }, { id: "r1", kind: RUNNER_KIND.docker }),
      null,
    );
  });
  it("process runner → null, even with the grant (silent degradation)", () => {
    assert.equal(
      browserForSession({ browserAccess: true }, { id: "r1", kind: RUNNER_KIND.process }),
      null,
    );
  });
});

// End to end: runTask builds the spec with (or without) the browser.

const PROJECT = "p1";
const RUNNER = "rdock";

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
after(() => wireFakeRunner(null));

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  // `lastSeenAt` since v51: `pickRunnerRow` refuses to route to a docker runner whose daemon never
  // answered, so a test runner meant to receive a session declares it just answered, otherwise
  // runTask would fail here with "no reachable runner".
  db.insert(schema.runners)
    .values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker, lastSeenAt: now })
    .run();
  provisioned = null;
}

function makeAgent(id: string, browserAccess: boolean) {
  db.insert(schema.agents)
    .values({
      id,
      projectId: PROJECT,
      name: `agent-${id}`,
      rolePrompt: "r",
      browserAccess,
      createdAt: new Date(),
    })
    .run();
}

function makeTask(id: string, agentId: string) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      assigneeAgentId: agentId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function specOf(taskId: string): Promise<Spec> {
  await runTask(taskId);
  await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
  assert.ok(provisioned, "the fake runner received a spec");
  return provisioned;
}

describe("runTask: the spec carries the browser if and only if the grant is set", () => {
  beforeEach(() => reset());

  it("granted agent on a docker runner: spec.browser + BROWSER_WS_ENDPOINT + instructions", async () => {
    makeAgent("a-yes", true);
    makeTask("t1", "a-yes");
    const spec = await specOf("t1");
    assert.deepEqual(spec.browser, {
      service: `legion-browser-${RUNNER}`,
      network: `legion-browser-net-${RUNNER}`,
    });
    assert.equal(spec.env.BROWSER_WS_ENDPOINT, `ws://legion-browser-${RUNNER}:3000/`);
    assert.ok(spec.rolePrompt.includes("Shared browser"), "the prompt explains how to use it");
    assert.ok(spec.rolePrompt.includes("playwright-core"), "…and what to connect with");
  });

  it("agent without the grant: no browser, no endpoint, no mention in the prompt", async () => {
    makeAgent("a-no", false);
    makeTask("t2", "a-no");
    const spec = await specOf("t2");
    assert.equal(spec.browser, null);
    assert.ok(!("BROWSER_WS_ENDPOINT" in spec.env), "no ghost endpoint");
    assert.ok(!spec.rolePrompt.includes("Shared browser"), "no instructions without the tool");
  });
});
