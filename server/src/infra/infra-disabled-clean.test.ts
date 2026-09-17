// A CLEAN disabled runner raises no alarm (04/09). The red residue banner fired on the PRESENCE of
// containers, not their orphan status. The runner with `dockerHost: null` points at the server's
// local socket, so `legion-control-plane-1` was attributed to it and Legion reported itself as
// residue, permanently (and `legion-update` during each update). "Clean" means no orphan, not no
// container. `infra-browser.test.ts` holds the other half.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-disabled-clean-"));
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

/** Returns ONLY what the server runs for itself (control plane, update container): no session,
 *  so no orphan. The state seen on 04/09 on the "local" runner. */
function installFakeDocker(): void {
  const file = join(dir, "docker");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      'case "$1 $2" in',
      '  "ps -a")',
      '    printf \'{"Names":"legion-control-plane-1","State":"running","Status":"Up 2 days","Image":"legion:latest"}\\n{"Names":"legion-update","State":"running","Status":"Up 1 minute","Image":"docker:28-cli"}\\n\'',
      "    exit 0 ;;",
      '  "network ls") exit 0 ;;',
      '  "volume ls") exit 0 ;;',
      '  "image inspect") echo "No such image" >&2; exit 1 ;;',
      '  "info --format") echo 8589934592; exit 0 ;;',
      "  *) exit 0 ;;",
      "esac",
    ].join("\n"),
    { mode: 0o755 },
  );
  chmodSync(file, 0o755);
  process.env.PATH = `${dir}:${REAL_PATH}`;
}

before(() => {
  installFakeDocker();
  // Disabled, local socket (dockerHost null): the "local" runner's exact configuration.
  db.insert(schema.runners)
    .values({
      id: "serveur1",
      name: "local",
      kind: RUNNER_KIND.docker,
      enabled: false,
      dockerHost: null,
      lastSeenAt: new Date(),
    })
    .run();
});

// 08/09: the list is no longer the filter (it hid a clean disabled runner and its re-enable button).
// Legion must still not report itself as residue; that now lives in the orphan COUNT.
describe("a disabled runner without orphans is listed, not accused", () => {
  it("it appears in disabledRunners, where its re-enable button lives", async () => {
    const over = await infraOverview();
    const local = over.disabledRunners.find((r) => r.runnerId === "serveur1");
    assert.ok(local, "a clean disabled runner must stay reachable from the screen");
  });

  it("the control plane and the update container are not orphans", async () => {
    // The count feeds the global signal AND the red banner: a false positive invites clicking
    // "clean up" on containers that run the product.
    const over = await infraOverview();
    const local = over.disabledRunners.find((r) => r.runnerId === "serveur1");
    assert.equal(
      local?.containers.filter((c) => c.orphan).length,
      0,
      "legion-control-plane-1 and legion-update have no session: they are orphans of nothing",
    );
  });

  it("and no orphan is counted, or the rail badge would lie too", async () => {
    const over = await infraOverview();
    assert.equal(over.orphanCount, 0);
  });
});
