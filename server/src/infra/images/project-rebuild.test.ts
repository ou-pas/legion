// Building a project image on a runner, on demand (09/09): `rebuild.test.ts` for a project. Since
// v67 the Dockerfile is a project field passed as an argument, no repo fixture. The `.ssh` mount
// came back on 12/09, not to clone but to REACH an `ssh://` runner.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { DockerExec, DockerResult } from "../../shared/docker-exec.js";

const dir = mkdtempSync(join(tmpdir(), "legion-project-rebuild-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { SESSION_IMAGE } = await import("../fleet-images.js");
const {
  projectRebuildArgs,
  projectRebuildContainerName,
  projectRebuildScript,
  startProjectImageRebuild,
} = await import("./project-rebuild.js");

const HOST = { repo: "/home/op/legion", home: "/home/op" };
const RUNNER = { id: "r-mbp", name: "portable-atelier", dockerHost: "ssh://operator@100.64.0.12" };
const PROJECT = {
  id: "prj-kopee",
  name: "Kopee",
  slug: "kopee-rebuild",
  tag: "legion-session-kopee:latest",
};
const DOCKERFILE = `FROM ${SESSION_IMAGE}\nRUN apt-get update && apt-get install -y php8.2-cli\n`;

function fakeExec(answers: (args: string[]) => Partial<DockerResult>) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "", ...answers(args) };
  };
  return { exec, calls };
}

function makeRunner(kind: "docker" | "process" = "docker") {
  db.insert(schema.runners)
    .values({
      id: RUNNER.id,
      name: RUNNER.name,
      kind,
      dockerHost: RUNNER.dockerHost,
      enabled: true,
    })
    .run();
}
function makeProject(
  sessionImage: string | null = PROJECT.tag,
  sessionDockerfile: string | null = DOCKERFILE,
) {
  db.insert(schema.projects)
    .values({
      id: PROJECT.id,
      name: PROJECT.name,
      slug: PROJECT.slug,
      sessionImage,
      sessionDockerfile,
      createdAt: new Date(),
    })
    .run();
}

const TARGET = { projectId: PROJECT.id, tag: PROJECT.tag, dockerfile: DOCKERFILE };

describe("projectRebuildScript: validate and build in one command, nothing to clone", () => {
  it("calls scripts/project-image.sh build with tag, base, dockerfile", () => {
    const script = projectRebuildScript(RUNNER, TARGET, "x.log");
    assert.match(
      script,
      /sh scripts\/project-image\.sh build 'legion-session-kopee:latest' '[^']+' '[^']+'/,
    );
    assert.match(script, new RegExp(SESSION_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  it("carries the Dockerfile text as is, newlines included", () => {
    assert.match(projectRebuildScript(RUNNER, TARGET, "x.log"), /RUN apt-get update/);
  });
  it("logs into the updates folder", () => {
    assert.match(
      projectRebuildScript(RUNNER, TARGET, "rebuild-project-x.log"),
      /server\/data\/updates\/rebuild-project-x\.log/,
    );
  });
  // v67 removed this copy with the repo clone ("no git, no key needed"). But a remote runner is a
  // `DOCKER_HOST=ssh://…`: without `known_hosts` docker refuses it ("Host key verification failed").
  it("copies the operator's .ssh: a remote runner is reached over ssh, even with nothing to clone", () => {
    assert.match(projectRebuildScript(RUNNER, TARGET, "x.log"), /\$HOME\/\.ssh/);
  });
});

describe("projectRebuildArgs: locked per (runner, project), key mounted read-only", () => {
  it("has a per-pair name, the socket, Legion's clone at the same path", () => {
    const args = projectRebuildArgs(HOST, RUNNER, {
      runnerId: RUNNER.id,
      target: TARGET,
      logName: "x.log",
    });
    assert.equal(args[0], "run");
    assert.equal(
      projectRebuildContainerName(RUNNER.id, PROJECT.id),
      "legion-rebuild-project-r-mbp-prj-kopee",
    );
    assert.ok(args.includes(projectRebuildContainerName(RUNNER.id, PROJECT.id)));
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
    assert.ok(args.includes(`${HOST.repo}:${HOST.repo}`));
    assert.ok(args.includes(`${HOST.home}/.ssh:${HOST.home}/.ssh:ro`));
    assert.ok(args.includes(`HOME=${HOST.home}`));
    assert.equal(args.at(-1), projectRebuildScript(RUNNER, TARGET, "x.log"));
  });
});

describe("startProjectImageRebuild: refusals carry their status", () => {
  beforeEach(() => {
    db.delete(schema.runners).run();
    db.delete(schema.projects).run();
  });
  const env = { LEGION_HOST_REPO: HOST.repo, LEGION_HOST_HOME: HOST.home };

  it("unknown runner: 404", async () => {
    makeProject();
    const { exec } = fakeExec(() => ({}));
    const r = await startProjectImageRebuild(PROJECT.id, "nobody", {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 404);
  });

  it("unknown project: 404", async () => {
    makeRunner();
    const { exec } = fakeExec(() => ({}));
    const r = await startProjectImageRebuild("nulle-part", RUNNER.id, {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 404);
  });

  it("`process` runner: 400, it has no container to build in", async () => {
    makeRunner("process");
    makeProject();
    const { exec } = fakeExec(() => ({}));
    const r = await startProjectImageRebuild(PROJECT.id, RUNNER.id, {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 400);
  });

  it("project without its own tag: 400", async () => {
    makeRunner();
    makeProject(null);
    const { exec } = fakeExec(() => ({}));
    const r = await startProjectImageRebuild(PROJECT.id, RUNNER.id, {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 400);
    assert.match(r.ok === false ? r.error : "", /no session image of its own/);
  });

  it("project without a declared Dockerfile: 400", async () => {
    makeRunner();
    makeProject(PROJECT.tag, null);
    const { exec } = fakeExec(() => ({}));
    const r = await startProjectImageRebuild(PROJECT.id, RUNNER.id, {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 400);
    assert.match(r.ok === false ? r.error : "", /Dockerfile/);
  });

  it("a build already running for THIS (runner, project): 409, without a second container", async () => {
    makeRunner();
    makeProject();
    const { exec, calls } = fakeExec((args) =>
      args[0] === "inspect" ? { code: 0, stdout: "true\n" } : {},
    );
    const r = await startProjectImageRebuild(PROJECT.id, RUNNER.id, {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 409);
    assert.ok(!calls.some((c) => c[0] === "run"));
  });

  it("nominal path: stopped carcass removed, then docker run starts with the script", async () => {
    makeRunner();
    makeProject();
    const { exec, calls } = fakeExec((args) =>
      args[0] === "inspect" ? { code: 0, stdout: "false\n" } : {},
    );
    const r = await startProjectImageRebuild(PROJECT.id, RUNNER.id, {
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
    assert.ok(run.includes(projectRebuildContainerName(RUNNER.id, PROJECT.id)));
    assert.match(r.ok ? r.value.logPath : "", /updates\/rebuild-project-r-mbp-prj-kopee-/);
    assert.equal(r.ok ? r.value.tag : "", PROJECT.tag);
  });

  it("a container that does not start: 502, with the daemon's stderr", async () => {
    makeRunner();
    makeProject();
    const { exec } = fakeExec((args) =>
      args[0] === "run" ? { code: 125, stderr: "docker: no space left" } : { code: 1 },
    );
    const r = await startProjectImageRebuild(PROJECT.id, RUNNER.id, {
      env,
      exec,
      mode: "docker",
      updatesDir: dir,
    });
    assert.equal(r.ok === false ? r.status : 0, 502);
    assert.match(r.ok === false ? r.error : "", /no space left/);
  });
});
