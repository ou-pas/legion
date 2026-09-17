// The disk sentinel alone: `ensureDiskSentinel` and the name extraction. `collectDisk` end to end is
// in `metrics/index.test.ts`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DockerExec, DockerResult } from "../shared/docker-exec.js";
import { diskSentinelName, diskSentinelRunnerId, ensureDiskSentinel } from "./disk-sentinel.js";

const ok = (stdout = ""): DockerResult => ({ code: 0, stdout, stderr: "" });
const ko = (stderr: string, code = 1): DockerResult => ({ code, stdout: "", stderr });
const fakeExec =
  (script: (args: string[]) => DockerResult): DockerExec =>
  (args) =>
    Promise.resolve(script(args));

describe("diskSentinelName / diskSentinelRunnerId: named per RUNNER, like browserNames", () => {
  it("round trip", () => {
    assert.equal(diskSentinelName("mini-atelier"), "legion-disk-sentinel-mini-atelier");
    assert.equal(diskSentinelRunnerId("legion-disk-sentinel-mini-atelier"), "mini-atelier");
  });

  it("a name without the prefix returns null, never a guessed empty string", () => {
    assert.equal(diskSentinelRunnerId("legion-session-abc"), null);
    assert.equal(diskSentinelRunnerId("legion-browser-mini-atelier"), null);
  });
});

describe("ensureDiskSentinel: idempotent, never recreated to measure", () => {
  it("already running: one call (`inspect`), no `run` or `rm`", async () => {
    const calls: string[] = [];
    const exec = fakeExec((args) => {
      calls.push(args[0]!);
      if (args[0] === "inspect") return ok("true\n");
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    await ensureDiskSentinel("legion-disk-sentinel-mini", "legion-session:latest", null, exec);
    assert.deepEqual(calls, ["inspect"]);
  });

  it("missing (never created): `run` with the name, the session image, and no network route", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "inspect") return ko("No such container", 1);
      if (args[0] === "run") {
        assert.deepEqual(args, [
          "run",
          "-d",
          "--name",
          "legion-disk-sentinel-mini",
          "--network",
          "none",
          "--init",
          "--memory=64m",
          "--cpus=0.1",
          "--entrypoint",
          "sleep",
          "legion-session:latest",
          "infinity",
        ]);
        return ok();
      }
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    await ensureDiskSentinel("legion-disk-sentinel-mini", "legion-session:latest", null, exec);
  });

  it("stopped (reboot, OOM): removed then recreated, stateless so nothing lost", async () => {
    const calls: string[] = [];
    const exec = fakeExec((args) => {
      calls.push(args[0]!);
      if (args[0] === "inspect") return ok("false\n");
      if (args[0] === "rm") return ok();
      if (args[0] === "run") return ok();
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    await ensureDiskSentinel("legion-disk-sentinel-mini", "legion-session:latest", null, exec);
    assert.deepEqual(calls, ["inspect", "rm", "run"]);
  });

  it("`run` fails (disk already full on the first round): the error carries the reason, never swallowed", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "inspect") return ko("No such container", 1);
      if (args[0] === "run") return ko("no space left on device", 1);
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    await assert.rejects(
      ensureDiskSentinel("legion-disk-sentinel-mini", "legion-session:latest", null, exec),
      /no space left on device/,
    );
  });
});
