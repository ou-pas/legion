// The fleet the updater rebuilds (02/09). `activeSshRunners()` is `docker-update.ts`'s only impure
// function: it reads `runners` with the same `enabled && kind === docker` filter as the probe
// (`infra/probe.ts`) and the orphan volume sweep. Separate file with its own database because it is
// the only part needing a `runners` table; the rest is tested with an injected list.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-runner-fleet-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { activeSshRunners } = await import("./docker-update.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

function reset(): void {
  db.delete(schema.runners).run();
}

function runner(
  id: string,
  over: { kind?: "docker" | "process"; enabled?: boolean; dockerHost?: string | null } = {},
): void {
  db.insert(schema.runners)
    .values({
      id,
      name: id,
      kind: over.kind ?? RUNNER_KIND.docker,
      enabled: over.enabled ?? true,
      dockerHost: over.dockerHost ?? null,
    })
    .run();
}

beforeEach(reset);

describe("activeSshRunners: the fleet the updater rebuilds after its own", () => {
  it("an enabled ssh:// runner is included", () => {
    runner("mini-atelier", { dockerHost: "ssh://operator@mini-atelier.local" });
    assert.deepEqual(activeSshRunners(), [
      { name: "mini-atelier", dockerHost: "ssh://operator@mini-atelier.local" },
    ]);
  });

  it("several enabled ssh:// runners are all included", () => {
    runner("mini-atelier", { dockerHost: "ssh://operator@mini-atelier.local" });
    runner("studio", { dockerHost: "ssh://operator@studio.local" });
    const names = activeSshRunners()
      .map((r) => r.name)
      .sort();
    assert.deepEqual(names, ["mini-atelier", "studio"]);
  });

  it("a disabled runner (`enabled: false`) is excluded: the operator took it out", () => {
    runner("mini-atelier", { dockerHost: "ssh://operator@mini-atelier.local", enabled: false });
    assert.deepEqual(activeSshRunners(), []);
  });

  it("the `process` runner (local, in the control plane) is excluded: no session image to rebuild", () => {
    runner("local", { kind: RUNNER_KIND.process, dockerHost: null });
    assert.deepEqual(activeSshRunners(), []);
  });

  it("a DOCKER runner without `dockerHost` (local socket) is included, with an EMPTY host", () => {
    // Changed 04/09, a real hole: this runner's session image was never rebuilt by an update and
    // stayed stale, with sessions dying at boot on an old payload with nothing but `exit 1`.
    // The update container carries the host's socket, so an empty `DOCKER_HOST` is the right
    // address for this daemon.
    runner("local-docker", { dockerHost: null });
    assert.deepEqual(activeSshRunners(), [{ name: "local-docker", dockerHost: "" }]);
  });

  it("but a PROCESS runner without dockerHost is still excluded", () => {
    // Both have `dockerHost: null`; only `kind` separates them.
    runner("local-process", { kind: RUNNER_KIND.process, dockerHost: null });
    assert.deepEqual(activeSshRunners(), []);
  });

  it("a tcp:// `DOCKER_HOST` is excluded: only ssh:// names a machine rebuilt this way", () => {
    runner("cloud", { dockerHost: "tcp://10.0.0.5:2375" });
    assert.deepEqual(activeSshRunners(), []);
  });

  it("no runner declared: an empty list, not an error", () => {
    assert.deepEqual(activeSshRunners(), []);
  });
});
