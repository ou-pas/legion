// The timeout added on 25/08 after an outage cost two ghost sessions and a dead `stop`: Docker
// stopped, `docker run` accepted the socket connection and never returned, the session stayed
// `starting`, and `stopSession`, using the same executor, froze too. A promise that never settles
// is silence, not an error.
//
// A fake `docker` on the PATH exercises the timeout deterministically with the real `spawn`.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  DOCKER_TIMEOUT_CODE,
  containerProbe,
  docker,
  dockerDaemonReachable,
} from "./docker-exec.js";

const dir = mkdtempSync(join(tmpdir(), "legion-docker-"));
const REAL_PATH = process.env.PATH ?? "";
after(() => {
  process.env.PATH = REAL_PATH;
  rmSync(dir, { recursive: true, force: true });
});

/** Puts a fake `docker` executable first on the PATH. */
function fakeDocker(script: string) {
  const file = join(dir, "docker");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  process.env.PATH = `${dir}:${REAL_PATH}`;
}

describe("docker(), a call that never completes is a failure, not a wait", () => {
  it("returns 124 when the daemon does not answer, without waiting for the process", async () => {
    fakeDocker("exec sleep 30"); // `exec` replaces sh with sleep so SIGKILL reaches it; otherwise
    // sleep survives holding the pipe and the test drags.
    const started = Date.now();
    const r = await docker(["run", "x"], null, 300);
    assert.equal(r.code, DOCKER_TIMEOUT_CODE);
    assert.match(r.stderr, /did not answer/);
    assert.ok(Date.now() - started < 5_000, "the timeout must cut, not follow the process");
  });

  it("lets a normal call through", async () => {
    fakeDocker('echo "24.0.7"');
    const r = await docker(["version"], null, 5_000);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "24.0.7");
  });

  it("keeps a clear failure clear, with its code and stderr", async () => {
    fakeDocker('echo "Cannot connect to the Docker daemon" >&2; exit 1');
    const r = await docker(["version"], null, 5_000);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Cannot connect/);
  });

  it("returns 127 for a missing CLI, a state to report, never a server crash", async () => {
    process.env.PATH = join(dir, "empty-on-purpose");
    const r = await docker(["version"], null, 5_000);
    assert.equal(r.code, 127);
    process.env.PATH = `${dir}:${REAL_PATH}`;
  });
});

describe("dockerDaemonReachable, the preflight question", () => {
  it("says yes when the daemon returns a version", async () => {
    fakeDocker('echo "24.0.7"');
    assert.deepEqual(await dockerDaemonReachable(null), { ok: true });
  });

  it("says no, and why, when the daemon refuses", async () => {
    fakeDocker(
      'echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock." >&2; exit 1',
    );
    const r = await dockerDaemonReachable(null);
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.why : "", /Cannot connect/);
  });

  it("says no when the daemon stays silent, the case that froze everything", async () => {
    fakeDocker("exec sleep 30"); // `exec`: see above
    const r = await dockerDaemonReachable(null);
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.why : "", /did not answer/);
  });

  it("does not take empty output as yes", async () => {
    fakeDocker("exit 0");
    assert.equal((await dockerDaemonReachable(null)).ok, false);
  });
});

describe("containerProbe, the sweep's verdict and its trace", () => {
  it('"true": alive', async () => {
    fakeDocker('echo "true"');
    const p = await containerProbe("c1", null);
    assert.equal(p.verdict, "alive");
    assert.equal(p.code, 0);
  });

  it('"false": exists but stopped, gone', async () => {
    fakeDocker('echo "false"');
    assert.equal((await containerProbe("c1", null)).verdict, "gone");
  });

  it('"No such object": the daemon answered, the container no longer exists, gone', async () => {
    fakeDocker('echo "Error: No such object: c1" >&2; exit 1');
    const p = await containerProbe("c1", null);
    assert.equal(p.verdict, "gone");
    assert.equal(p.code, 1);
    assert.match(p.stderr, /No such object/);
  });

  it("silent daemon: unknown, reported with code 124", async () => {
    fakeDocker("exec sleep 30");
    const p = await containerProbe("c1", null);
    assert.equal(p.verdict, "unknown");
    assert.equal(p.code, DOCKER_TIMEOUT_CODE);
    assert.match(p.stderr, /did not answer/);
  });

  it("transport failure (ssh 255): unknown, stderr kept", async () => {
    fakeDocker(
      'echo "ssh: connect to host 100.64.0.11 port 22: Operation timed out" >&2; exit 255',
    );
    const p = await containerProbe("c1", "ssh://operator@100.64.0.11");
    assert.equal(p.verdict, "unknown");
    assert.equal(p.code, 255);
    assert.match(p.stderr, /Operation timed out/);
  });

  it("measures duration, which shows whether the probe nears its budget", async () => {
    fakeDocker('sleep 0.2; echo "true"');
    const p = await containerProbe("c1", null);
    assert.ok(p.ms >= 150, `ms=${p.ms}`);
  });
});

describe('the "unbounded" budget, and its only legitimate use', () => {
  it("really waits: no implicit cap cuts the call", async () => {
    fakeDocker("sleep 1; exit 7");
    const started = Date.now();
    const r = await docker(["wait", "c"], null, "unbounded");
    assert.equal(r.code, 7, "the real exit code, not a timeout 124");
    assert.ok(Date.now() - started >= 900, "the call must have waited for the process");
  });

  // A source guard: the invariant is not in a type, so it is read from the files. A default 120 s
  // cap once killed every session at exactly 120 s with an unrelated "exit code 1" diagnostic; if
  // someone "harmonises budgets", this test fails before sessions do.
  //
  // It scans all of `server/src` (01/09): when the call moved files, a single-file guard found zero
  // uncapped calls and failed saying the opposite of what it watches. Moving the call must break
  // nothing; adding a second must break everything.
  it("`docker wait` is the project's only uncapped call", () => {
    // All files, and the word "unbounded" read line by line, immune to formatting (an injection seam
    // like `this.exec` once made a name-based guard mute).
    const root = new URL("..", import.meta.url);
    const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
      // `docker-exec.ts` defines the contract; the guard watches call sites.
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("docker-exec.ts"));
    const src = sources.map((f) => readFileSync(new URL(f, root), "utf8")).join("\n");
    const unbounded = src
      .split("\n")
      .filter(
        (l) => l.includes('"unbounded"') && !l.trim().startsWith("*") && !l.trim().startsWith("//"),
      );
    assert.equal(unbounded.length, 1, `one uncapped call expected, found ${unbounded.length}`);
    assert.match(unbounded[0]!, /"wait"/, "the only uncapped call must be `docker wait`");

    // Explicit budgets on recognisable calls. The floor keeps the guard from going mute (an older
    // pattern knowing only `docker` once matched zero calls and validated everything).
    const calls = src.match(/(?:\bdocker|this\.exec|\bexec)\(\[[^\]]*\][^)]*\)/g) ?? [];
    assert.ok(calls.length >= 6, `mute guard: only ${calls.length} call(s) recognised`);
    for (const call of calls.filter((c) => !c.includes('"unbounded"')))
      // `STOP` (05/09) has its own cap derived from the stop grace; a number written in place is
      // what stays forbidden.
      assert.match(
        call,
        /DOCKER_(QUICK|START|PROBE|STOP)_MS/,
        `missing budget: ${call.slice(0, 80)}`,
      );
  });

  // The sibling invariant (`provision` removes leftovers before creating) lives in
  // `sessions/runner/docker-provision.test.ts`: `shared/` may not import `DockerRunner`.
});
