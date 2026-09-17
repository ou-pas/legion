// The pre-start cleanup guards against leftovers (25/08).
//
// A session resumes under its own id (inbox pause → destroy → resume), so container and volume
// names are deterministic. If the pause cleanup failed (docker rm -f over budget, busy daemon), the
// resume hit "The container name is already in use". It happened on 25/08 on an interview: two
// rounds answered, 51 minutes, and the session dead at the second wake-up.
//
// The guard: remove everything carrying our names BEFORE creating. Tested on ARGUMENTS, like
// `docker-destroy.test.ts`: call order is not observable on a real daemon, and the failure was
// silent.
//
// Merged with `docker-provision-order.test.ts` (structure review, pass 2): PRs #165 and #166 each
// replaced the same spelling test on `provision()` with a behaviour test without seeing the other.
// The case specific to #166, seeding the secrets volume in volume mode, is kept below.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-docker-provision-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { DockerRunner } = await import("./docker.js");

/** A fake docker recording what it is asked, in order. */
function recorder(result = { code: 0, stdout: "container-sha256\n", stderr: "" }) {
  const calls: Array<{
    args: string[];
    budget: unknown;
    command: string;
  }> = [];
  const exec = (args: string[], _host: string | null, budget: unknown) => {
    const command = args[0] ?? "";
    calls.push({ args, budget, command });
    return Promise.resolve(result);
  };
  return { exec, calls };
}

describe("DockerRunner.provision: cleanup precedes any creation", () => {
  const minimalSpec = {
    sessionId: "s1",
    callbackUrl: "http://127.0.0.1:8787",
    claudeStateDir: join(dir, "claude"),
    workspaceDir: join(dir, "workspace"),
    packageCacheDir: null,
    image: null,
    sshKeyPath: null,
    sshKnownHostsPath: null,
    browser: null,
    network: { mode: "open" as const },
    env: {},
  } as unknown as import("./types.js").SessionSpec;

  it("removes the names before any creation", async () => {
    const { exec, calls } = recorder();
    const runner = new DockerRunner(null, undefined, exec, "bare");
    const handle = await runner.provision(minimalSpec);

    assert.ok(handle.id === "s1", "provision must return the session handle");
    assert.ok(calls.length > 0, "provision must call exec");

    const commands = calls.map((c) => c.command);
    const rmIndex = commands.indexOf("rm");
    const runIndex = commands.indexOf("run");

    assert.ok(rmIndex >= 0, "provision must call `docker rm` to clean up");
    assert.ok(runIndex > rmIndex, "cleanup must precede container creation");
  });

  it("in limited mode, removes the names before creating the network and the proxy", async () => {
    const limitedSpec = {
      ...minimalSpec,
      network: { mode: "limited" as const, allowedHosts: ["github.com"] },
    };
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(limitedSpec);

    const commands = calls.map((c) => c.command);
    const rmIndex = commands.lastIndexOf("rm");
    const networkIndex = commands.indexOf("network");
    const runIndex = commands.indexOf("run");

    assert.ok(rmIndex >= 0 && networkIndex > rmIndex, "cleanup must precede network creation");
    assert.ok(rmIndex >= 0 && runIndex > rmIndex, "cleanup must precede proxy creation");
  });

  it("removes the proxy AND the session container, in this order or together", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(minimalSpec);

    const rmCalls = calls.filter((c) => c.command === "rm");
    assert.ok(rmCalls.length >= 1, "at least one `docker rm` expected");

    const allRmArgs = rmCalls.flatMap((c) => c.args);
    assert.ok(allRmArgs.includes("legion-session-s1"), "must clean the session container");
    assert.ok(allRmArgs.includes("legion-proxy-s1"), "must clean the proxy");
  });

  it("secrets volumes are removed before `mounts` recreates them", async () => {
    // On the volume path, `mounts` seeds the secrets volume `sweepNames` just removed, so a resume
    // never reuses a key placed by the previous run.
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(minimalSpec);

    const rmIndex = Math.max(...calls.filter((c) => c.command === "rm").map((_, i) => i));
    const firstNonRmIndex = calls.findIndex((c, i) => i > rmIndex && c.command !== "rm");

    assert.ok(firstNonRmIndex > rmIndex, "cleanup must be among the first operations");
  });

  it("no graceful `stop` before start: leftovers are already dead", async () => {
    // `destroy` asks for grace before `rm -f` (05/09): a live container deserves a clean stop.
    // Before start there is nobody to ask, the leftover died with the previous run, and thirty
    // seconds of grace would delay every launch for nothing.
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(minimalSpec);

    assert.deepEqual(
      calls.filter((c) => c.command === "stop"),
      [],
      "provision must not call `docker stop`",
    );
  });

  it("the cleanup budget is short: a dead leftover, not a stop request", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(minimalSpec);

    const rmCalls = calls.filter((c) => c.command === "rm");
    assert.ok(rmCalls.length > 0, "at least one `docker rm` expected");

    // `rm -f` gets a short budget, not `stop`'s, which waits for the grace period.
    // `DOCKER_QUICK_MS` (30 s) is the right one.
    for (const call of rmCalls) {
      assert.ok(
        typeof call.budget === "number" && call.budget <= 30_000,
        `budget too long for a leftover cleanup: ${String(call.budget)}`,
      );
    }
  });

  it("in volume mode, seeds the secrets volume only after sweeping leftovers", async () => {
    // On a remote runner or a containerised control plane, `mounts` places the secrets volume
    // through `docker run --rm --entrypoint /bin/sh` (seedSecretVolume, volumes.ts) instead of the
    // local bind mount. A resume must never reuse a key from the previous run, so the sweep must
    // precede this seeding too, not only the `-d` creations.
    const keyPath = join(dir, "id_test");
    writeFileSync(keyPath, "test-key\n", { mode: 0o600 });
    const volumesSpec = { ...minimalSpec, sshKeyPath: keyPath };
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "docker").provision(volumesSpec);

    const rmIndexes = calls.map((c, i) => (c.command === "rm" ? i : -1)).filter((i) => i >= 0);
    assert.ok(rmIndexes.length > 0, "at least one `docker rm` expected");
    const lastRmIndex = Math.max(...rmIndexes);

    const seedIndex = calls.findIndex(
      (c) => c.command === "run" && c.args.includes("--rm") && c.args.includes("--entrypoint"),
    );
    assert.ok(seedIndex >= 0, "the secrets volume must be seeded");
    assert.ok(seedIndex > lastRmIndex, "seeding the secrets volume must follow the sweep");
  });
});
