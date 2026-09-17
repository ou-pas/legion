// Slice 06 of the multi-machine work (v52, 01/09).
//
// The terminal resume command named `<LEGION_DATA>/sessions/<id>/claude`, a path on the CONTROL
// PLANE's disk. For a session that ran on an `ssh://` runner, the Claude state is in the OTHER
// machine's `legion-claude-<id>` volume: the command opened an empty conversation, without an error,
// IN the operator's terminal, the one place the control plane can no longer explain anything.
//
// Proofs, in criteria order:
//
//  1. LOCAL runner: the command is the pre-slice one, character for character, and NO docker call is
//     made. The common case does not pay for the remote one.
//  2. `ssh://` runner: the state is brought back through THE RUNNER'S DOCKER_HOST (the central
//     assertion: a single call to the local daemon would copy nothing), then the returned command is
//     the SAME as the local one. An already brought-back state is not copied again: that would
//     overwrite the conversation the operator just continued.
//  3. The three dead ends (sleeping machine, swept volume, refused copy) return a SENTENCE, never a
//     command. A missing `docker` is a state, not a test failure, hence the injected executor.
//
// Criterion 1 goes through Hono (the route is what is frozen), the other two call the function: the
// route takes no executor, and a real daemon cannot play "the machine sleeps".
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-resume-command-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { resumeCommandFor } = await import("./resume-command.js");
const { registerSessionRoutes } = await import("./routes.js");
const { volumeNames, DEFAULT_SESSION_IMAGE } = await import("./runner/volumes.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerSessionRoutes(app);

const P1 = "p1",
  A1 = "a1",
  RUNNER = "r1",
  TASK = "t1",
  SESSION = "s1",
  SID = "sdk-abc123";
const HOST = "ssh://operator@mini-atelier";
const CLAUDE_DIR = join(dir, "sessions", SESSION, "claude");
/** The pre-slice command written out: IT is what is frozen, and a constant derived from the code
 *  would freeze nothing. */
const EXPECTED = `CLAUDE_CONFIG_DIR='${CLAUDE_DIR}' claude --resume ${SID}`;

function seed(
  opts: {
    dockerHost?: string | null;
    sdkSessionId?: string | null;
    mock?: boolean;
    projectImage?: string | null;
  } = {},
) {
  const now = new Date();
  // One test's local state must not pass for the next test's brought-back state.
  rmSync(join(dir, "sessions"), { recursive: true, force: true });
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects)
    .values({
      id: P1,
      name: "P1",
      slug: "p1",
      createdAt: now,
      sessionImage: opts.projectImage ?? null,
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: A1,
      projectId: P1,
      name: "build",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners)
    .values({
      id: RUNNER,
      name: "mini-atelier",
      kind: RUNNER_KIND.docker,
      dockerHost: opts.dockerHost ?? null,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: P1,
      name: "Resume from anywhere",
      status: TASK_STATUS.doing,
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: A1,
      runnerId: RUNNER,
      model: "sonnet",
      status: "destroyed",
      callbackToken: "tok",
      startedAt: now,
      mock: opts.mock ?? false,
      sdkSessionId: opts.sdkSessionId === undefined ? SID : opts.sdkSessionId,
    })
    .run();
}

/** Success. stdout is NON-EMPTY by default, not decoratively: `dockerDaemonReachable`'s probe
 *  treats a silent daemon as absent, so a fake returning an empty string would play "the machine
 *  sleeps" without saying so. */
const ok = (stdout = "27.0.3") => ({ code: 0, stdout, stderr: "" });
const ko = (stderr: string, code = 1) => ({ code, stdout: "", stderr });

/** A fake docker recording each call's HOST. The `script` answers per verb: each scenario only has
 *  to say which one fails. */
function recorder(
  script: (args: string[]) => { code: number; stdout: string; stderr: string } = () => ok(),
) {
  const calls: { args: string[]; host: string | null }[] = [];
  const exec = (args: string[], host: string | null) => {
    calls.push({ args, host });
    return Promise.resolve(script(args));
  };
  return { exec, calls };
}
/** The first call whose arguments start with this verb (`cp`, `create`, `version`…). */
const call = (calls: { args: string[] }[], verb: string) => calls.find((c) => c.args[0] === verb);
const verbs = (calls: { args: string[] }[]) => calls.map((c) => c.args[0]);

describe("AC#1: a LOCAL runner session, today's command unchanged", () => {
  beforeEach(() => seed());

  it("the route returns the frozen command, and its note", async () => {
    const res = await app.request(`/api/sessions/${SESSION}/resume-command`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      command: EXPECTED,
      note: "resumes the agent's conversation in your terminal, with all its context",
    });
  });

  it("and talks to NO daemon for it", async () => {
    const { exec, calls } = recorder();
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(r.ok && r.command, EXPECTED);
    assert.deepEqual(calls, []);
  });

  it("pre-slice refusals are intact: unknown session, mock, missing sdkSessionId", async () => {
    assert.equal((await app.request("/api/sessions/doesnotexist/resume-command")).status, 404);
    seed({ mock: true });
    assert.equal((await app.request(`/api/sessions/${SESSION}/resume-command`)).status, 400);
    seed({ sdkSessionId: null });
    assert.equal((await app.request(`/api/sessions/${SESSION}/resume-command`)).status, 400);
  });

  it("an sdkSessionId that is not a nanoid is refused before entering a shell command", async () => {
    seed({ sdkSessionId: "x'; rm -rf /" });
    const res = await app.request(`/api/sessions/${SESSION}/resume-command`);
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /unsafe/);
  });
});

describe("Found along the way: this GET mutates, so it goes through the origin guard", () => {
  // The `http/app.ts` middleware only covers mutating verbs: a GET was not one. This one now writes
  // to the control plane's disk and creates a container over there.
  it("a call from another origin is refused, before any disk access", async () => {
    seed({ dockerHost: HOST });
    const res = await app.request(`/api/sessions/${SESSION}/resume-command`, {
      headers: { origin: "https://not-legion.example" },
    });
    assert.equal(res.status, 403);
    assert.equal(existsSync(CLAUDE_DIR), false);
  });

  it("and the UI passes: its origin is the instance's", async () => {
    seed();
    // `Origin` AND `Host` together since 13/09: the guard no longer asks whether the address belongs
    // to an allowed network, but whether the page comes from this instance. An `Origin` alone no
    // longer means anything, which is the rule's point.
    const res = await app.request(`/api/sessions/${SESSION}/resume-command`, {
      headers: { origin: "http://localhost:5173", host: "localhost:5173" },
    });
    assert.equal(res.status, 200);
  });
});

// The install mode also decides for the local daemon (05/09).
//
// A containerised control plane stores its OWN sessions' Claude state in a volume
// (`mount-mode.ts`): returning the local command would open `claude --resume` on an empty folder,
// exactly the failure this file fixes for `ssh://`. The mode is passed as an argument; without it
// it is read from disk, as all other tests here do.
describe("AC#4: the same local runner, depending on the install mode", () => {
  beforeEach(() => seed());

  it("in CONTAINER mode, the state is brought back from the volume, through the local daemon", async () => {
    const { exec, calls } = recorder();
    const r = await resumeCommandFor(SESSION, exec, "docker");
    assert.equal(r.ok, true);
    assert.deepEqual(verbs(calls), ["version", "volume", "rm", "create", "cp", "rm"]);
    // `host: null`: this machine's daemon, but a VOLUME and not a folder.
    for (const c of calls) assert.equal(c.host, null);
    assert.deepEqual(call(calls, "volume")!.args, [
      "volume",
      "inspect",
      volumeNames(SESSION).claudeState,
    ]);
  });

  it("in CLONE mode nothing moves: the frozen command, and no docker call", async () => {
    const { exec, calls } = recorder();
    const r = await resumeCommandFor(SESSION, exec, "bare");
    assert.equal(r.ok && r.command, EXPECTED);
    assert.deepEqual(calls, []);
  });
});

describe("AC#2: an ssh:// runner session, the state is brought back and the command becomes local", () => {
  beforeEach(() => seed({ dockerHost: HOST }));

  it("the docker gestures go to THE RUNNER'S DOCKER_HOST, on the right volume", async () => {
    const { exec, calls } = recorder();
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(r.ok, true);
    const v = volumeNames(SESSION).claudeState;
    assert.deepEqual(verbs(calls), ["version", "volume", "rm", "create", "cp", "rm"]);
    // The central assertion: a single one of these calls to the local daemon would copy nothing.
    for (const c of calls)
      assert.equal(c.host, HOST, `“${c.args.join(" ")}” did not go to ${HOST}`);
    assert.deepEqual(call(calls, "volume")!.args, ["volume", "inspect", v]);
    assert.deepEqual(call(calls, "create")!.args, [
      "create",
      "--pull=never",
      "--entrypoint",
      "/bin/true",
      "--name",
      `legion-copy-${v}`,
      "-v",
      `${v}:/claude-state`,
      DEFAULT_SESSION_IMAGE,
    ]);
    assert.deepEqual(call(calls, "cp")!.args, [
      "cp",
      `legion-copy-${v}:/claude-state/.`,
      CLAUDE_DIR,
    ]);
  });

  it("the returned command is the SAME as a local session's: one gesture in the product", async () => {
    const { exec } = recorder();
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(r.ok && r.command, EXPECTED);
    assert.match(r.ok ? r.note : "", /brought back from mini-atelier/);
    // The destination folder exists: `docker cp` refuses a missing destination, so its absence would
    // mean a copy that never happened.
    assert.equal(existsSync(CLAUDE_DIR), true);
  });

  it("the PROJECT image is the copy container's when the project declares one", async () => {
    seed({ dockerHost: HOST, projectImage: " legion-php:latest " });
    const { exec, calls } = recorder();
    await resumeCommandFor(SESSION, exec);
    assert.equal(call(calls, "create")!.args.at(-1), "legion-php:latest");
  });

  it("an ALREADY brought-back state is not copied again: overwriting it would destroy the resumed conversation", async () => {
    const first = recorder((args) => {
      // The real `docker cp` writes the files; the fake must too, otherwise the second request cannot
      // know the state arrived.
      if (args[0] === "cp") writeFileSync(join(CLAUDE_DIR, ".claude.json"), "{}");
      return ok();
    });
    assert.equal((await resumeCommandFor(SESSION, first.exec)).ok, true);
    const again = recorder();
    const r = await resumeCommandFor(SESSION, again.exec);
    assert.equal(r.ok && r.command, EXPECTED);
    assert.deepEqual(again.calls, [], "no call: neither probe nor copy");
  });
});

describe("AC#3: when remote resume is impossible, the answer says so", () => {
  beforeEach(() => seed({ dockerHost: HOST }));

  it("sleeping machine: the sentence names the machine and the volume, and there is no command", async () => {
    const { exec, calls } = recorder((args) =>
      args[0] === "version" ? ko("docker version did not answer within 5 s", 124) : ok(),
    );
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
    const error = !r.ok ? r.error : "";
    assert.match(error, /“mini-atelier” is not answering/);
    assert.match(error, new RegExp(volumeNames(SESSION).claudeState));
    assert.ok(!("command" in r), "no command may be returned");
    assert.deepEqual(verbs(calls), ["version"], "no insisting on a sleeping machine");
  });

  it("swept volume: the sentence says nothing is left to resume, not a docker error", async () => {
    const { exec, calls } = recorder((args) =>
      args[0] === "volume" ? ko("Error: No such volume") : ok(),
    );
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(!r.ok && r.status, 409);
    assert.match(!r.ok ? r.error : "", /no longer exists on this host/);
    assert.deepEqual(verbs(calls), ["version", "volume"]);
  });

  it("image missing over there: `--pull=never` refuses, and the refusal is readable", async () => {
    const { exec } = recorder((args) =>
      args[0] === "create" ? ko("Error: image not known, pull policy never") : ok(),
    );
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(!r.ok && r.status, 409);
    assert.match(!r.ok ? r.error : "", /copy container refused/);
  });

  it("refused copy: no command, and the copy container is removed anyway", async () => {
    const { exec, calls } = recorder((args) =>
      args[0] === "cp" ? ko("Error: permission denied") : ok(),
    );
    const r = await resumeCommandFor(SESSION, exec);
    assert.equal(!r.ok && r.status, 409);
    assert.match(!r.ok ? r.error : "", /could not be brought back from “mini-atelier”/);
    assert.equal(verbs(calls).at(-1), "rm", "a forgotten container is worse than an error read");
  });

  it("the route relays the refusal as is: 409 and the sentence, never a command that will fail", async () => {
    // The only test through the REAL route with the REAL docker, so the only one proving the refusal
    // reaches the client. `.invalid` is reserved by RFC 2606: no resolver finds it, here or on the
    // operator's machine; a plausible host would make this test flaky the day it really exists. A
    // missing Docker (code 127) leads to the same refusal.
    seed({ dockerHost: "ssh://nobody@missing-runner.invalid" });
    const res = await app.request(`/api/sessions/${SESSION}/resume-command`);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; command?: string };
    assert.equal(body.command, undefined);
    assert.match(body.error ?? "", /“mini-atelier”/);
  });
});
