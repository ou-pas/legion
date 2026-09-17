// Orphan cleanup SEES and COUNTS volumes like containers and networks (v52, slice 02). On a remote
// runner a session's files are docker volumes nobody else reclaims; a forgotten one is 640 MB of
// dependencies on a machine nobody watches.
//
// A fake executable on PATH, not a module mock: it exercises the real `spawn`, the `{{json .}}`
// parsing and the database join.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-infra-vol-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
delete process.env.LEGION_INFRA_FAKE; // fixtures prove nothing here
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
const { sweepOrphanVolumes } = await import("../sessions/runner/workspace.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

/** Logs removals to a file: the only way to assert WHAT was removed and in which ORDER (a
 *  `volume rm` before its container's `rm -f` always fails). */
const LOG = join(dir, "calls.log");
function installFakeDocker(): void {
  const file = join(dir, "docker");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      `echo "$@" >> ${LOG}`,
      'case "$1 $2" in',
      // Two volumes of `sOrphan` (ended in the database) and the shared cache. Inspection asks
      // `{{json .}}`, the sweep `{{.Name}}`; the fake answers both.
      '  "volume ls") case "$*" in *"{{.Name}}"*) printf \'legion-workspace-sOrphan\\nlegion-claude-sOrphan\\nlegion-secrets-sLive\\nlegion-pkg-cache\\n\' ;;' +
        ' *) printf \'{"Name":"legion-workspace-sOrphan"}\\n{"Name":"legion-claude-sOrphan"}\\n{"Name":"legion-pkg-cache"}\\n\' ;; esac; exit 0 ;;',
      '  "volume rm") exit 0 ;;',
      // An orphan container of the same session: it must go BEFORE its volumes.
      '  "ps -a") printf \'{"Names":"legion-session-sOrphan","State":"exited","Status":"Exited (0) 2 hours ago","Image":"legion-session:latest"}\\n\'; exit 0 ;;',
      "  \"network ls\") printf ''; exit 0 ;;",
      '  "image inspect") echo "No such image" >&2; exit 1 ;;',
      '  "info --format") echo 8589934592; exit 0 ;;',
      "esac",
      "exit 0",
    ].join("\n") + "\n",
  );
  chmodSync(file, 0o755);
  process.env.PATH = `${dir}:${REAL_PATH}`;
}

before(() => {
  const now = new Date();
  db.insert(schema.projects).values({ id: "p1", name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: "a1", projectId: "p1", name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners)
    .values({
      id: "r1",
      name: "mini",
      kind: RUNNER_KIND.docker,
      dockerHost: "ssh://mini-atelier",
      lastSeenAt: now,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: "p1",
      name: "t",
      status: TASK_STATUS.done,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  // ENDED, which orphans its volumes. A `waiting` session would keep them: a pause is not an end.
  db.insert(schema.sessions)
    .values({
      id: "sOrphan",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: "destroyed",
      callbackToken: "k",
      startedAt: now,
    })
    .run();
  // INBOX-PAUSED, so ALIVE: its volumes must survive the sweep, or unpushed work is lost.
  db.insert(schema.tasks)
    .values({
      id: "t2",
      projectId: "p1",
      name: "t2",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "sLive",
      taskId: "t2",
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: SESSION_STATUS.waiting,
      callbackToken: "k",
      startedAt: now,
    })
    .run();
  installFakeDocker();
});

describe("infra: volumes are seen, and counted as orphans", () => {
  it("the inspection lists them with their role, and the shared cache is NEVER orphan", async () => {
    const over = await infraOverview();
    const runner = over.runners[0]!;
    assert.deepEqual(runner.volumes, [
      { name: "legion-workspace-sOrphan", role: "workspace", sessionId: "sOrphan", orphan: true },
      { name: "legion-claude-sOrphan", role: "claude-state", sessionId: "sOrphan", orphan: true },
      // No session owns it: it serves them all, like the shared browser.
      { name: "legion-pkg-cache", role: "autre", sessionId: null, orphan: false },
    ]);
  });

  it("`orphanCount` adds them: the number the cleanup button announces", async () => {
    const over = await infraOverview();
    // 1 container + 0 network + 2 volumes. Without volumes the button said "1" and erased three.
    assert.equal(over.orphanCount, 3);
  });

  it("cleanup removes them, AFTER the container mounting them", async () => {
    rmSync(LOG, { force: true });
    const { removed, errors } = cleaned(await cleanupOrphans("r1"));
    assert.deepEqual(errors, []);
    assert.deepEqual(removed, [
      "legion-session-sOrphan",
      "legion-workspace-sOrphan",
      "legion-claude-sOrphan",
    ]);
    // ORDER is the point: docker refuses `volume rm` while a container, even stopped, mounts it.
    const log = (await import("node:fs")).readFileSync(LOG, "utf8").split("\n").filter(Boolean);
    const iContainer = log.findIndex((l) => l.startsWith("rm -f legion-session-"));
    const iVolume = log.findIndex((l) => l.startsWith("volume rm legion-workspace-"));
    assert.ok(iContainer >= 0 && iVolume > iContainer, `ordre inattendu :\n${log.join("\n")}`);
  });
});

describe("the boot sweep sees remote machines, not only the local disk", () => {
  it("takes volumes of ended sessions and LEAVES those of a paused session", async () => {
    rmSync(LOG, { force: true });
    const swept = await sweepOrphanVolumes();
    // `sOrphan` is ended (two volumes), `sLive` is inbox-paused (one volume, kept).
    assert.deepEqual(swept, { released: 2, kept: 1 });
    const log = (await import("node:fs")).readFileSync(LOG, "utf8");
    assert.match(log, /volume rm legion-workspace-sOrphan/);
    assert.match(log, /volume rm legion-claude-sOrphan/);
    // The line that matters: `waiting` has no container but will resume (D13).
    assert.ok(!log.includes("legion-secrets-sLive"), `a paused session lost its files:\n${log}`);
    // The shared cache belongs to nobody, so it is never a candidate.
    assert.ok(!log.includes("volume rm legion-pkg-cache"));
  });
});

// The sweep must see the LOCAL daemon when it holds the volumes (05/09). It filtered runners on
// having a `dockerHost`, wrong for a containerised control plane running on its own daemon. Last in
// the file because it adds a second runner.
describe("the sweep follows the install mode, not the presence of a dockerHost", () => {
  it("a LOCAL daemon runner joins the sweep in container mode, not in clone mode", async () => {
    const now = new Date();
    db.insert(schema.runners)
      .values({
        id: "r2",
        name: "local",
        kind: RUNNER_KIND.docker,
        dockerHost: null,
        lastSeenAt: now,
      })
      .run();

    // Clone mode: only `mini` (ssh://) is swept.
    rmSync(LOG, { force: true });
    assert.deepEqual(await sweepOrphanVolumes("bare"), { released: 2, kept: 1 });

    // Container mode: BOTH are. The fake answers the same list to each, so counts double; what is
    // measured is the local runner's participation.
    rmSync(LOG, { force: true });
    assert.deepEqual(await sweepOrphanVolumes("docker"), { released: 4, kept: 2 });
  });
});
