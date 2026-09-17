// The 03/09 task: shared browsers piled up with nothing able to remove them, because
// `parseSessionId` returned `sessionId: null` for every `legion-browser-*` without looking at the
// RUNNER. Three measured scenarios, with a fake docker on PATH routed by `$DOCKER_HOST`:
//
//  1. `portable-atelier` (enabled) and `local` (disabled) share one daemon (dockerHost null), with
//     two browser containers: the legitimate one and `local`'s residue with its network.
//  2. `mini-atelier` (enabled) holds a browser network WITHOUT a container.
//  3. A disabled runner whose daemon still holds something appears in `disabledRunners`.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-infra-browser-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
delete process.env.LEGION_INFRA_FAKE;
const REAL_PATH = process.env.PATH ?? "";
after(() => {
  process.env.PATH = REAL_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const { db, schema } = await import("../shared/db.js");
const { infraOverview, cleanupOrphans } = await import("./infra.js");

/** `cleanupOrphans` returns its refusal (06/09); an unexpected one fails the test BY NAME. */
function cleaned(r: Awaited<ReturnType<typeof cleanupOrphans>>) {
  assert.ok(r.ok, r.ok ? "" : `refus inattendu : ${r.error}`);
  return r.value;
}
const { RUNNER_KIND } = await import("../shared/enums.js");

const LOG = join(dir, "calls.log");

/** Routed by `$DOCKER_HOST` like the real one: the local daemon and `mini-atelier` answer
 *  differently. */
function installFakeDocker(): void {
  const file = join(dir, "docker");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      `echo "DOCKER_HOST=$DOCKER_HOST $@" >> ${LOG}`,
      'case "$1 $2" in',
      '  "ps -a")',
      '    if [ -z "$DOCKER_HOST" ]; then',
      // portable-atelier / local, same daemon: two browser containers.
      '      printf \'{"Names":"legion-browser-macpro1","State":"running","Status":"Up 3 days","Image":"legion-browser:latest"}\\n{"Names":"legion-browser-local1","State":"running","Status":"Up 40 days","Image":"legion-browser:latest"}\\n\'',
      "    else",
      // mini-atelier: no browser container, its residue is only a network.
      "      printf ''",
      "    fi",
      "    exit 0 ;;",
      '  "network ls")',
      '    if [ -z "$DOCKER_HOST" ]; then',
      // The `local` residue's network, matching its container (for the order test).
      '      printf \'{"Name":"legion-browser-net-local1"}\\n\'',
      "    else",
      // mini-atelier: the network survives alone, the exact 03/09 case.
      '      printf \'{"Name":"legion-browser-net-mini1"}\\n\'',
      "    fi",
      "    exit 0 ;;",
      '  "volume ls") exit 0 ;;',
      '  "rm -f") exit 0 ;;',
      '  "network rm") exit 0 ;;',
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
  // `local`: dockerHost null, DISABLED, the 03/09 residue.
  db.insert(schema.runners)
    .values({
      id: "local1",
      name: "local",
      kind: RUNNER_KIND.docker,
      dockerHost: null,
      enabled: false,
      lastSeenAt: null,
    })
    .run();
  // `portable-atelier`: same daemon, ENABLED.
  db.insert(schema.runners)
    .values({
      id: "macpro1",
      name: "portable-atelier",
      kind: RUNNER_KIND.docker,
      dockerHost: null,
      enabled: true,
      lastSeenAt: now,
    })
    .run();
  // `mini-atelier`: separate daemon, ENABLED, yet its browser network is orphan: for networks the
  // missing container counts too.
  db.insert(schema.runners)
    .values({
      id: "mini1",
      name: "mini-atelier",
      kind: RUNNER_KIND.docker,
      dockerHost: "ssh://mini-atelier",
      enabled: true,
      lastSeenAt: now,
    })
    .run();
  installFakeDocker();
  process.env.PATH = `${dir}:${REAL_PATH}`;
});

describe("a browser named for a DISABLED runner is orphan, one for an ENABLED runner is not", () => {
  it("the inspection tells both containers apart on the same daemon", async () => {
    const over = await infraOverview();
    const runner = over.runners.find((r) => r.runnerId === "macpro1")!;
    const legit = runner.containers.find((c) => c.name === "legion-browser-macpro1")!;
    const residue = runner.containers.find((c) => c.name === "legion-browser-local1")!;
    assert.equal(legit.orphan, false, "the enabled runner's browser must never be marked orphan");
    assert.equal(residue.orphan, true, "the disabled runner's browser must be marked orphan");
    // Its matching network too.
    const net = runner.networks.find((n) => n.name === "legion-browser-net-local1")!;
    assert.equal(net.orphan, true);
  });

  it("cleaning portable-atelier removes the residue AND its network, AFTER the container", async () => {
    rmSync(LOG, { force: true });
    const { removed, errors } = cleaned(await cleanupOrphans("macpro1"));
    assert.deepEqual(errors, []);
    assert.deepEqual(removed, ["legion-browser-local1", "legion-browser-net-local1"]);
    // ORDER is the point: a network cannot be removed while a container, even stopped, is
    // attached, so `rm -f` must precede `network rm`.
    const log = readFileSync(LOG, "utf8").split("\n").filter(Boolean);
    const iContainer = log.findIndex((l) => l.includes("rm -f legion-browser-local1"));
    const iNetwork = log.findIndex((l) => l.includes("network rm legion-browser-net-local1"));
    assert.ok(iContainer >= 0 && iNetwork > iContainer, `unexpected order:\n${log.join("\n")}`);
    // The legitimate browser was never touched.
    assert.ok(
      !log.some((l) => l.includes("legion-browser-macpro1")),
      `the enabled browser was touched:\n${log.join("\n")}`,
    );
  });
});

describe("a browser network WITHOUT its container is waste, even on an enabled runner", () => {
  it("mini-atelier: the network is marked orphan although the runner is enabled", async () => {
    const over = await infraOverview();
    const mini = over.runners.find((r) => r.runnerId === "mini1")!;
    assert.deepEqual(mini.containers, []);
    const net = mini.networks.find((n) => n.name === "legion-browser-net-mini1")!;
    assert.equal(net.orphan, true);
  });

  it("cleaning mini-atelier removes the network", async () => {
    rmSync(LOG, { force: true });
    const { removed, errors } = cleaned(await cleanupOrphans("mini1"));
    assert.deepEqual(errors, []);
    assert.deepEqual(removed, ["legion-browser-net-mini1"]);
  });
});

describe("a disabled runner whose daemon still holds something is no longer invisible", () => {
  it("appears in `disabledRunners`, with its browser and network marked orphan", async () => {
    const over = await infraOverview();
    const local = over.disabledRunners.find((r) => r.runnerId === "local1");
    assert.ok(local, "the disabled runner with residue must appear in disabledRunners");
    assert.equal(local!.containers.find((c) => c.name === "legion-browser-local1")!.orphan, true);
    // It is NOT mixed into the enabled runners list.
    assert.ok(!over.runners.some((r) => r.runnerId === "local1"));
  });

  it("`orphanCount` counts this residue too: it is the signal, not only the list", async () => {
    const over = await infraOverview();
    assert.ok(over.orphanCount > 0);
  });
});
