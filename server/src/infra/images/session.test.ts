// Read through a fake `docker` on PATH (as in docker-exec.test.ts) and the on-demand rebuild lock
// file (bare mode: the test repo has a `.git`).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-session-image-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
const REAL_PATH = process.env.PATH ?? "";
after(() => {
  process.env.PATH = REAL_PATH;
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  rmSync(join(dir, "updates"), { recursive: true, force: true });
});

const { PAYLOAD_HASH_LABEL, sessionImageState } = await import("./session.js");
const { SESSION_IMAGE } = await import("../fleet-images.js");
const { latestImageVerdict, resetImageVerdictStoreForTests } = await import("./verdict-store.js");

function fakeDocker(script: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, "docker"), 0o755);
  process.env.PATH = `${bin}:${REAL_PATH}`;
}

const RUNNER = { id: "r1", dockerHost: null };

describe("sessionImageState: what the daemon holds, against what the repo says", () => {
  it("label equal to the current hash: present, up to date", async () => {
    fakeDocker('echo "abc"');
    assert.deepEqual(await sessionImageState(RUNNER, "abc"), {
      present: true,
      builtHash: "abc",
      currentHash: "abc",
      stale: false,
      rebuilding: false,
    });
  });

  it("different label: present, STALE", async () => {
    fakeDocker('echo "old"');
    const s = await sessionImageState(RUNNER, "new");
    assert.equal(s.present, true);
    assert.equal(s.stale, true);
  });

  it("missing label (built without it): stale too, we do not know what it carries", async () => {
    fakeDocker("echo");
    const s = await sessionImageState(RUNNER, "new");
    assert.equal(s.builtHash, null);
    assert.equal(s.stale, true);
  });

  it("unknown current hash: nothing to compare, not stale", async () => {
    fakeDocker('echo "old"');
    assert.equal((await sessionImageState(RUNNER, null)).stale, false);
  });

  it("failed inspect: MISSING on this runner, to be shown", async () => {
    fakeDocker('echo "No such image" >&2; exit 1');
    const s = await sessionImageState(RUNNER, "abc");
    assert.equal(s.present, false);
    assert.equal(s.stale, false);
  });

  it("a rebuild in progress is read (bare mode: the lock file)", async () => {
    fakeDocker('echo "old"');
    mkdirSync(join(dir, "updates"), { recursive: true });
    writeFileSync(join(dir, "updates", "rebuild-r1.lock"), "now\n");
    assert.equal((await sessionImageState(RUNNER, "new")).rebuilding, true);
  });

  it("the label read is the one the `image-session` recipe stamps", () => {
    assert.equal(PAYLOAD_HASH_LABEL, "legion.payload-hash");
  });
});

describe("sessionImageState: remembers its verdict for pickRunnerRow (12/09)", () => {
  beforeEach(() => resetImageVerdictStoreForTests());

  it("present: the remembered verdict is a success", async () => {
    fakeDocker('echo "abc"');
    await sessionImageState(RUNNER, "abc");
    assert.equal(latestImageVerdict(RUNNER.id, SESSION_IMAGE)?.ok, true);
  });

  it("missing: the remembered verdict is a refusal, with its reason", async () => {
    fakeDocker('echo "No such image" >&2; exit 1');
    await sessionImageState(RUNNER, "abc");
    const v = latestImageVerdict(RUNNER.id, SESSION_IMAGE);
    assert.equal(v?.ok, false);
    assert.match(v?.why ?? "", /No such image/);
  });
});
