// The disk sentinel in `infra.ts`: same orphan criterion as the browser service (shared, named per
// runner, orphan once its runner is disabled or gone). Only role and orphan status in
// `inspectRunner`; the `df` mechanics are tested elsewhere.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-infra-disk-sentinel-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
delete process.env.LEGION_INFRA_FAKE;
const REAL_PATH = process.env.PATH ?? "";
after(() => {
  process.env.PATH = REAL_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const { db, schema } = await import("../shared/db.js");
const { infraOverview } = await import("./infra.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

function installFakeDocker(): void {
  const file = join(dir, "docker");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      'case "$1 $2" in',
      '  "ps -a")',
      // The same daemon (dockerHost null) holds both sentinels: the live one and the residue.
      '    printf \'{"Names":"legion-disk-sentinel-active1","State":"running","Status":"Up 3 days","Image":"legion-session:latest"}\\n{"Names":"legion-disk-sentinel-gone1","State":"running","Status":"Up 40 days","Image":"legion-session:latest"}\\n\'',
      "    exit 0 ;;",
      '  "network ls") exit 0 ;;',
      '  "volume ls") exit 0 ;;',
      '  "rm -f") exit 0 ;;',
      '  "image inspect") echo "No such image" >&2; exit 1 ;;',
      '  "info --format") echo 8589934592; exit 0 ;;',
      "esac",
      "exit 0",
    ].join("\n") + "\n",
  );
  chmodSync(file, 0o755);
}

before(() => {
  const now = new Date();
  db.insert(schema.runners)
    .values({
      id: "active1",
      name: "active",
      kind: RUNNER_KIND.docker,
      dockerHost: null,
      enabled: true,
      lastSeenAt: now,
    })
    .run();
  // `gone1` exists ONLY in the container name, the "never seen" case `isOrphanBrowserContainer`
  // treats as orphan.
  installFakeDocker();
  process.env.PATH = `${dir}:${REAL_PATH}`;
});

describe("the disk sentinel follows the shared browser's orphan criterion", () => {
  it("role `disk-sentinel`, sessionId null, never counted as a session", async () => {
    const over = await infraOverview();
    const runner = over.runners.find((r) => r.runnerId === "active1")!;
    const own = runner.containers.find((c) => c.name === "legion-disk-sentinel-active1")!;
    assert.equal(own.role, "disk-sentinel");
    assert.equal(own.sessionId, null);
    assert.equal(own.orphan, false, "an enabled runner's sentinel must never be orphan");
  });

  it("a sentinel named for a runner no longer in the table is orphan", async () => {
    const over = await infraOverview();
    const runner = over.runners.find((r) => r.runnerId === "active1")!;
    const residue = runner.containers.find((c) => c.name === "legion-disk-sentinel-gone1")!;
    assert.equal(residue.orphan, true);
  });
});
