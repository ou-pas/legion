// A project's session image: the validator (a contract between TypeScript and
// `scripts/project-image.sh`), the cascade targets, and the state read against a fake `docker` on
// PATH. The Dockerfile is a project field (v67), set directly in the database.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const dir = mkdtempSync(join(tmpdir(), "legion-project-image-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
const REAL_PATH = process.env.PATH ?? "";
after(() => {
  process.env.PATH = REAL_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const { db, schema } = await import("../../shared/db.js");
const { SESSION_IMAGE } = await import("../fleet-images.js");
const {
  combinedImageHash,
  projectImageState,
  projectImageTargets,
  runnerProjectImages,
  validateProjectDockerfile,
} = await import("./project.js");

function fakeDocker(script: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, "docker"), 0o755);
  process.env.PATH = `${bin}:${REAL_PATH}`;
}

const PROJECT = "prj-image-test";

before(() => {
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "Kopee", slug: "kopee-image-test", createdAt: new Date() })
    .run();
});

// The real shape of a project Dockerfile: the base ends with `USER agent`, so installing anything
// means switching to root and back (`USER` accepted since 12/09).
const VALID = `FROM ${SESSION_IMAGE}\nUSER root\nRUN apt-get update && apt-get install -y \\\n    php8.2-cli\nENV X=1\nUSER agent\n`;
const BAD_FROM = `FROM ubuntu:latest\nRUN echo hi\n`;
const BAD_INSTR = `FROM ${SESSION_IMAGE}\nCMD ["sh"]\n`;
const BAD_COPY = `FROM ${SESSION_IMAGE}\nCOPY files/ /opt/x/\n`;
const BAD_SECOND_FROM = `FROM ${SESSION_IMAGE}\nFROM ubuntu:latest\n`;
const EMPTY = "";

describe("validateProjectDockerfile: the trust rule", () => {
  it("accepts FROM <base>, USER/RUN/ENV, and a line continuation", () => {
    assert.deepEqual(validateProjectDockerfile(VALID, SESSION_IMAGE), { ok: true });
  });
  it("refuses a FROM other than the base", () => {
    const v = validateProjectDockerfile(BAD_FROM, SESSION_IMAGE);
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.error, /first instruction/);
  });
  it("refuses an instruction other than RUN\\/ENV\\/USER", () => {
    const v = validateProjectDockerfile(BAD_INSTR, SESSION_IMAGE);
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.error, /CMD/);
  });
  it("refuses COPY: no build context to copy from since v67", () => {
    const v = validateProjectDockerfile(BAD_COPY, SESSION_IMAGE);
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.error, /COPY/);
  });
  it("refuses a second FROM", () => {
    assert.equal(validateProjectDockerfile(BAD_SECOND_FROM, SESSION_IMAGE).ok, false);
  });
  it("refuses an empty dockerfile", () => {
    assert.equal(validateProjectDockerfile(EMPTY, SESSION_IMAGE).ok, false);
  });

  it("scripts/project-image.sh returns the SAME verdict: a contract between both languages", () => {
    for (const [name, content] of [
      ["valid", VALID],
      ["bad-from", BAD_FROM],
      ["bad-instr", BAD_INSTR],
      ["bad-copy", BAD_COPY],
      ["bad-second-from", BAD_SECOND_FROM],
    ] as const) {
      const file = join(dir, `${name}.Dockerfile`);
      writeFileSync(file, content);
      const ts = validateProjectDockerfile(content, SESSION_IMAGE);
      let shellOk = true;
      try {
        execFileSync(
          "sh",
          [join(ROOT, "scripts/project-image.sh"), "validate", file, SESSION_IMAGE],
          { stdio: "pipe" },
        );
      } catch {
        shellOk = false;
      }
      assert.equal(shellOk, ts.ok, `${name} : shell=${shellOk} ts=${ts.ok}`);
    }
  });
});

describe("combinedImageHash: same scheme as the shell pipe", () => {
  it('sha256("payload:dockerfile")', () => {
    const shell = execFileSync(
      "sh",
      ["-c", "printf '%s:%s' abc def | (shasum -a 256 2>/dev/null || sha256sum) | cut -d' ' -f1"],
      { encoding: "utf8" },
    ).trim();
    assert.equal(combinedImageHash("abc", "def"), shell);
  });
});

describe("projectImageTargets: the cascade", () => {
  it("drops a project without a tag, or without a declared Dockerfile", () => {
    const p1 = "prj-no-tag";
    const p2 = "prj-no-dockerfile";
    db.insert(schema.projects)
      .values({
        id: p1,
        name: "NoTag",
        slug: "no-tag-cascade",
        sessionDockerfile: VALID,
        createdAt: new Date(),
      })
      .run();
    db.insert(schema.projects)
      .values({
        id: p2,
        name: "NoDockerfile",
        slug: "no-dockerfile-cascade",
        sessionImage: "x:latest",
        createdAt: new Date(),
      })
      .run();
    const targets = projectImageTargets();
    assert.equal(
      targets.some((t) => t.projectId === p1),
      false,
    );
    assert.equal(
      targets.some((t) => t.projectId === p2),
      false,
    );
  });

  it("keeps a project with a tag AND a Dockerfile", () => {
    const p = "prj-both-ok";
    db.insert(schema.projects)
      .values({
        id: p,
        name: "Ok",
        slug: "both-ok-cascade",
        sessionImage: "legion-session-ok:latest",
        sessionDockerfile: VALID,
        createdAt: new Date(),
      })
      .run();
    const t = projectImageTargets().find((x) => x.projectId === p);
    assert.ok(t);
    assert.equal(t?.tag, "legion-session-ok:latest");
    assert.equal(t?.dockerfile, VALID.trim());
  });
});

describe("projectImageState", () => {
  const p = "prj-state";
  before(() => {
    db.insert(schema.projects)
      .values({
        id: p,
        name: "State",
        slug: "state-image",
        sessionImage: "legion-session-state:latest",
        createdAt: new Date(),
      })
      .run();
  });

  it("null when the project declares no tag", async () => {
    const other = "prj-state-none";
    db.insert(schema.projects)
      .values({ id: other, name: "None", slug: "state-none", createdAt: new Date() })
      .run();
    assert.equal(
      await projectImageState(
        { id: "r1", dockerHost: null },
        { id: other, sessionImage: null, sessionDockerfile: null },
      ),
      null,
    );
  });

  it("failed inspect: missing, currentHash null while no Dockerfile is declared", async () => {
    fakeDocker('echo "No such image" >&2; exit 1');
    const s = await projectImageState(
      { id: "r1", dockerHost: null },
      { id: p, sessionImage: "legion-session-state:latest", sessionDockerfile: null },
    );
    assert.equal(s?.present, false);
    assert.equal(s?.dockerfile.present, false);
    assert.equal(s?.currentHash, null);
    assert.equal(s?.stale, false);
  });

  it("declared valid Dockerfile: currentHash set, present with a different label = stale", async () => {
    fakeDocker('echo "deadbeef"');
    const s = await projectImageState(
      { id: "r1", dockerHost: null },
      { id: p, sessionImage: "legion-session-state:latest", sessionDockerfile: VALID },
    );
    assert.equal(s?.dockerfile.present, true);
    assert.equal(s?.dockerfile.valid, true);
    assert.ok(s?.currentHash);
    assert.equal(s?.present, true);
    assert.equal(s?.stale, true, "the stamped label (deadbeef) cannot be the real combined hash");
  });

  it("declared but invalid Dockerfile: dockerfile.valid=false, currentHash stays null", async () => {
    fakeDocker('echo "whatever"');
    const s = await projectImageState(
      { id: "r1", dockerHost: null },
      { id: p, sessionImage: "legion-session-state:latest", sessionDockerfile: BAD_INSTR },
    );
    assert.equal(s?.dockerfile.present, true);
    assert.equal(s?.dockerfile.valid, false);
    assert.match(s?.dockerfile.error ?? "", /CMD/);
    assert.equal(s?.currentHash, null);
  });
});

// 11/09: THIS runner is fixed and the loop covers every declaring project. The name travels WITH
// the state, and a project without a tag is absent.
describe("runnerProjectImages: one runner, all projects", () => {
  const withTag = "prj-runner-images-with-tag";
  const withoutTag = "prj-runner-images-without-tag";
  before(() => {
    db.insert(schema.projects)
      .values({
        id: withTag,
        name: "Kopee",
        slug: "runner-images-with-tag",
        sessionImage: "legion-session-kopee:latest",
        createdAt: new Date(),
      })
      .run();
    db.insert(schema.projects)
      .values({
        id: withoutTag,
        name: "No image",
        slug: "runner-images-without-tag",
        createdAt: new Date(),
      })
      .run();
  });

  it("drops projects without a tag, names the others, probes THEIR tag on this runner", async () => {
    fakeDocker('echo "No such image" >&2; exit 1');
    const rows = await runnerProjectImages({ id: "r1", dockerHost: null });
    assert.equal(
      rows.some((r) => r.projectId === withoutTag),
      false,
    );
    const row = rows.find((r) => r.projectId === withTag);
    assert.ok(row);
    assert.equal(row?.projectName, "Kopee");
    assert.equal(row?.image.tag, "legion-session-kopee:latest");
    assert.equal(row?.image.present, false);
  });

  it("relays `rebuilding` from deps, per (runner, project)", async () => {
    fakeDocker('echo "deadbeef"');
    const seen: { runnerId: string; projectId: string }[] = [];
    const rows = await runnerProjectImages(
      { id: "r-rebuild", dockerHost: null },
      {
        rebuilding: async (runnerId, projectId) => {
          seen.push({ runnerId, projectId });
          return projectId === withTag;
        },
      },
    );
    // Other declaring projects exist in this file's database: only ours is checked.
    const row = rows.find((r) => r.projectId === withTag);
    assert.equal(row?.image.rebuilding, true);
    assert.ok(seen.some((s) => s.runnerId === "r-rebuild" && s.projectId === withTag));
  });
});
