// On-demand image rebuild (07/09). Pinned: the script is the update's (same `if`, `say`,
// `SHELL=/bin/sh`) restricted to one runner and the requested images; the container name is per
// runner and is the lock; refusals carry their status.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { DockerExec, DockerResult } from "../../shared/docker-exec.js";

const dir = mkdtempSync(join(tmpdir(), "legion-image-rebuild-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { IMAGE_TARGET, rebuildArgs, rebuildContainerName, rebuildScript, startImageRebuild } =
  await import("./rebuild.js");

const HOST = { repo: "/home/op/legion", home: "/home/op" };
const RUNNER = { id: "r-mbp", name: "portable-atelier", dockerHost: "ssh://operator@100.64.0.12" };

function fakeExec(answers: (args: string[]) => Partial<DockerResult>) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "", ...answers(args) };
  };
  return { exec, calls };
}

function makeRunner(kind: "docker" | "process" = "docker", enabled = true) {
  db.insert(schema.runners)
    .values({
      id: RUNNER.id,
      name: RUNNER.name,
      kind,
      dockerHost: RUNNER.dockerHost,
      enabled,
    })
    .run();
}

describe("rebuildScript: the update's step, restricted to one machine", () => {
  it("names the runner, the host and each requested image, in fleet order", () => {
    const script = rebuildScript(RUNNER, [IMAGE_TARGET.browser, IMAGE_TARGET.session], "x.log");
    assert.match(script, /RUNNER_NAME='portable-atelier'/);
    assert.match(script, /RUNNER_HOST='ssh:\/\/operator@100\.64\.0\.12'/);
    // FLEET_MAKE_TARGETS order (session, browser, proxy), not the call's.
    assert.ok(
      script.indexOf("make SHELL=/bin/sh image-session") <
        script.indexOf("make SHELL=/bin/sh image-browser"),
    );
    assert.doesNotMatch(script, /image-proxy/);
  });

  it("logs into the updates folder, under the given name", () => {
    const script = rebuildScript(RUNNER, [IMAGE_TARGET.session], "rebuild-r-mbp-2026.log");
    assert.match(script, /server\/data\/updates\/rebuild-r-mbp-2026\.log/);
    assert.match(script, /exec >>"\$LOG" 2>&1/);
  });

  it("copies the operator's .ssh, like the update: an ssh:// host needs it", () => {
    assert.match(
      rebuildScript(RUNNER, [IMAGE_TARGET.session], "x.log"),
      /cp -R "\$HOME\/\.ssh\/\." \/root\/\.ssh\//,
    );
  });

  it("does not touch the clone: no fetch, no merge, no up.sh", () => {
    const script = rebuildScript(RUNNER, [IMAGE_TARGET.session], "x.log");
    assert.doesNotMatch(script, /git fetch|git merge|up\.sh/);
  });
});

describe("rebuildArgs: the ephemeral container, locked per runner", () => {
  it("has a per-runner name, the host socket, the clone at the same path and the key", () => {
    const args = rebuildArgs(HOST, RUNNER, { keys: [IMAGE_TARGET.session], logName: "x.log" });
    assert.equal(args[0], "run");
    assert.ok(args.includes(rebuildContainerName(RUNNER.id)));
    assert.equal(rebuildContainerName(RUNNER.id), "legion-rebuild-r-mbp");
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
    assert.ok(args.includes(`${HOST.repo}:${HOST.repo}`));
    assert.ok(args.includes(`${HOST.home}/.ssh:${HOST.home}/.ssh:ro`));
    assert.equal(args.at(-1), rebuildScript(RUNNER, [IMAGE_TARGET.session], "x.log"));
  });
});

describe("startImageRebuild: refusals carry their status", () => {
  beforeEach(() => {
    db.delete(schema.runners).run();
  });

  const env = { LEGION_HOST_REPO: HOST.repo, LEGION_HOST_HOME: HOST.home };

  it("unknown runner: 404", async () => {
    const { exec } = fakeExec(() => ({}));
    const r = await startImageRebuild("nobody", ["session"], {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false ? r.status : 0, 404);
  });

  it("`process` runner: 400, it has no session image to rebuild", async () => {
    makeRunner("process");
    const { exec } = fakeExec(() => ({}));
    const r = await startImageRebuild(RUNNER.id, ["session"], {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 400);
  });

  it("a rebuild already running on THIS runner: 409, without a second container", async () => {
    makeRunner();
    const { exec, calls } = fakeExec((args) =>
      args[0] === "inspect" ? { code: 0, stdout: "true\n" } : {},
    );
    const r = await startImageRebuild(RUNNER.id, ["session"], {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 409);
    assert.ok(!calls.some((c) => c[0] === "run"));
  });

  it("docker mode without LEGION_HOST_REPO: 400, naming what is missing", async () => {
    makeRunner();
    const { exec } = fakeExec(() => ({}));
    const r = await startImageRebuild(RUNNER.id, ["session"], {
      env: {},
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 400);
    assert.match(r.ok === false ? r.error : "", /LEGION_HOST_REPO/);
  });

  it("nominal path: a stopped carcass is removed, then `docker run` starts with the script", async () => {
    makeRunner();
    const { exec, calls } = fakeExec((args) =>
      args[0] === "inspect" ? { code: 0, stdout: "false\n" } : {},
    );
    const r = await startImageRebuild(RUNNER.id, ["session", "browser"], {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["inspect", "rm", "run"],
    );
    const run = calls[2]!;
    assert.ok(run.includes(rebuildContainerName(RUNNER.id)));
    assert.match(run.at(-1) ?? "", /image-session[\s\S]*image-browser/);
    assert.match(r.ok ? r.value.logPath : "", /updates\/rebuild-r-mbp-/);
    assert.deepEqual(r.ok ? r.value.targets : [], ["session", "browser"]);
  });

  it("a container that does not start: 502, with the daemon's stderr", async () => {
    makeRunner();
    const { exec } = fakeExec((args) =>
      args[0] === "run" ? { code: 125, stderr: "docker: no space left" } : { code: 1 },
    );
    const r = await startImageRebuild(RUNNER.id, ["session"], {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 502);
    assert.match(r.ok === false ? r.error : "", /no space left/);
  });
});
