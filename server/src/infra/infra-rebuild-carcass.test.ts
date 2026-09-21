// Image rebuild containers in `infra.ts`: launched without `--rm` so `docker logs` stays readable,
// they stay behind once exited. A stopped carcass is orphan (the cleanup removes it, the log file on
// the host remains); a running rebuild never is.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-infra-rebuild-carcass-"));
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

const rows = [
  { Names: "legion-rebuild-active1", State: "exited", Status: "Exited (0) 2 days ago" },
  {
    Names: "legion-rebuild-project-active1-proj1",
    State: "exited",
    Status: "Exited (0) 1 day ago",
  },
  { Names: "legion-rebuild-project-active1-proj2", State: "running", Status: "Up 2 minutes" },
  { Names: "some-unrelated-legion-thing", State: "exited", Status: "Exited (0) 1 day ago" },
].map((r) => JSON.stringify({ ...r, Image: "legion-updater:latest" }));

function installFakeDocker(): void {
  const file = join(dir, "docker");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      'case "$1 $2" in',
      `  "ps -a") printf '%s\\n' ${rows.map((r) => `'${r}'`).join(" ")}; exit 0 ;;`,
      '  "network ls") exit 0 ;;',
      '  "volume ls") exit 0 ;;',
      '  "image inspect") echo "No such image" >&2; exit 1 ;;',
      '  "info --format") echo 8589934592; exit 0 ;;',
      "esac",
      "exit 0",
    ].join("\n") + "\n",
  );
  chmodSync(file, 0o755);
}

before(() => {
  db.insert(schema.runners)
    .values({
      id: "active1",
      name: "active",
      kind: RUNNER_KIND.docker,
      dockerHost: null,
      enabled: true,
      lastSeenAt: new Date(),
    })
    .run();
  installFakeDocker();
  process.env.PATH = `${dir}:${REAL_PATH}`;
});

async function containerNamed(name: string) {
  const over = await infraOverview();
  const runner = over.runners.find((r) => r.runnerId === "active1");
  const found = runner?.containers.find((c) => c.name === name);
  assert.ok(found, `${name} is listed`);
  return found;
}

describe("image rebuild carcasses are cleaned up", () => {
  it("an exited runner rebuild is orphan", async () => {
    assert.equal((await containerNamed("legion-rebuild-active1")).orphan, true);
  });

  it("an exited project rebuild is orphan", async () => {
    assert.equal((await containerNamed("legion-rebuild-project-active1-proj1")).orphan, true);
  });

  it("a running rebuild is never orphan", async () => {
    assert.equal((await containerNamed("legion-rebuild-project-active1-proj2")).orphan, false);
  });

  it("a container outside the `legion-rebuild-` prefix stays untouched", async () => {
    assert.equal((await containerNamed("some-unrelated-legion-thing")).orphan, false);
  });
});
