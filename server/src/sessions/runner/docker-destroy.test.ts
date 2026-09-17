// Destroying starts with asking (05/09).
//
// `destroy` did `docker rm -f`, a SIGKILL: the runtime had no time to push what it had just done,
// and an operator-requested stop threw away the work of the session it stopped. The missing
// gesture is a `docker stop` with its grace period, BEFORE the `rm -f` that stays for what the
// grace did not cover.
//
// Tested on ARGUMENTS, like `remote-mounts.test.ts`: call order is not observable on a real daemon
// without making it last thirty seconds, and the failure being fixed was silent.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-docker-destroy-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { DockerRunner } = await import("./docker.js");

/** A fake docker recording what it is asked, with the granted budget. */
function recorder(result = { code: 0, stdout: "", stderr: "" }) {
  const calls: { args: string[]; budget: unknown }[] = [];
  const exec = (args: string[], _host: string | null, budget: unknown) => {
    calls.push({ args, budget });
    return Promise.resolve(result);
  };
  return { exec, calls };
}

/** Each command, in order: the order is what is at stake. */
const verbs = (calls: { args: string[] }[]) => calls.map((c) => c.args.join(" "));

describe("DockerRunner.destroy: the clean stop precedes destruction", () => {
  it("`stop -t 30` on the session container, BEFORE the `rm -f`", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").destroy({ id: "s1", runtime: "x" });

    assert.deepEqual(verbs(calls), [
      "stop -t 30 legion-session-s1",
      "rm -f legion-session-s1",
      "rm -f legion-proxy-s1",
      "network rm legion-net-s1",
    ]);
  });

  it("the call budget exceeds the grace period, otherwise a clean stop looks like a failure", async () => {
    // `DOCKER_QUICK_MS` (30 s) would land right on the deadline: the CLI would be killed the second
    // the container finishes stopping, and the report would say the daemon is not answering.
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").destroy({ id: "s1", runtime: "x" });

    const stop = calls.find((c) => c.args[0] === "stop");
    assert.equal(typeof stop?.budget, "number");
    assert.ok(
      (stop?.budget as number) >= 40_000,
      `budget too short for 30 s of grace: ${String(stop?.budget)}`,
    );
  });

  it("`rm -f` stays, and runs even when the clean stop fails", async () => {
    // Grace not enough, daemon refused, container already gone: in all three cases destruction
    // must complete. A failing `stop` brings nothing down.
    const { exec, calls } = recorder({ code: 1, stdout: "", stderr: "boom" });
    await new DockerRunner(null, undefined, exec, "bare").destroy({ id: "s1", runtime: "x" });

    assert.ok(verbs(calls).includes("rm -f legion-session-s1"));
    assert.ok(verbs(calls).includes("rm -f legion-proxy-s1"));
  });

  it("the pre-start sweep asks nothing: there is nobody to ask", async () => {
    // `sweepNames` prepares for a starting session: what it removes is a LEFTOVER of the previous
    // run, already dead. Thirty seconds of grace would delay every launch for nothing.
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision({
      sessionId: "s1",
      callbackUrl: "http://127.0.0.1:8787",
      claudeStateDir: join(dir, "claude"),
      workspaceDir: join(dir, "workspace"),
      packageCacheDir: null,
      image: null,
      sshKeyPath: null,
      sshKnownHostsPath: null,
      browser: null,
      network: { mode: "open" },
      env: {},
    } as unknown as import("./types.js").SessionSpec);

    assert.deepEqual(
      calls.filter((c) => c.args[0] === "stop"),
      [],
    );
  });
});
