// `runner-store.ts` only reads and writes the `runners` registry, without decisions.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-runner-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  allRunners,
  deleteRunnerRow,
  dockerRunnerRefs,
  enabledRunners,
  insertRunner,
  runnerByName,
  runnerById,
  runnerEnabledMap,
  updateRunner,
} = await import("./runner-store.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const R = "r-store";
const R2 = "r-store-2";

beforeEach(() => {
  db.delete(schema.runners).run();
});

describe("runner-store", () => {
  it("insertRunner, then runnerById/runnerByName find it", () => {
    insertRunner({ id: R, name: "local", kind: RUNNER_KIND.docker });
    assert.equal(runnerById(R)?.name, "local");
    assert.equal(runnerById("absent"), undefined);
    assert.equal(runnerByName("local")?.id, R);
    assert.equal(runnerByName("absent"), undefined);
  });

  it("updateRunner changes the requested fields, deleteRunnerRow removes the row", () => {
    insertRunner({ id: R, name: "local", kind: RUNNER_KIND.docker, maxConcurrentSessions: 3 });
    updateRunner(R, { maxConcurrentSessions: 6 });
    assert.equal(runnerById(R)?.maxConcurrentSessions, 6);
    deleteRunnerRow(R);
    assert.equal(runnerById(R), undefined);
  });

  it("allRunners returns everything, enabledRunners filters on enabled", () => {
    insertRunner({ id: R, name: "local", kind: RUNNER_KIND.docker, enabled: true });
    insertRunner({ id: R2, name: "home", kind: RUNNER_KIND.docker, enabled: false });
    assert.deepEqual(
      allRunners()
        .map((r) => r.id)
        .sort(),
      [R, R2],
    );
    assert.deepEqual(
      enabledRunners().map((r) => r.id),
      [R],
    );
  });

  it("runnerEnabledMap carries ALL runners, enabled or not", () => {
    insertRunner({ id: R, name: "local", kind: RUNNER_KIND.docker, enabled: true });
    insertRunner({ id: R2, name: "home", kind: RUNNER_KIND.docker, enabled: false });
    assert.deepEqual(
      runnerEnabledMap(),
      new Map([
        [R, true],
        [R2, false],
      ]),
    );
  });

  it("dockerRunnerRefs returns only docker runners, as minimal references", () => {
    insertRunner({
      id: R,
      name: "local",
      kind: RUNNER_KIND.docker,
      dockerHost: "unix:///var/run/docker.sock",
    });
    insertRunner({ id: R2, name: "cli", kind: RUNNER_KIND.process });
    assert.deepEqual(dockerRunnerRefs(), [
      { id: R, name: "local", dockerHost: "unix:///var/run/docker.sock" },
    ]);
  });
});
