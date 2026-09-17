// Fleet health probe (01/09):
//  1. `last_seen_at` is kept per runner, through ITS docker_host; an answer advances it.
//  2. A runner that stops answering is unreachable within two periods, and reachable again on its
//     own once it answers (the predicate itself is in `runner-reachability.test.ts`).
//  3. ONLY the transition goes to the control log, not the ticking.
//  4. A `process` runner is always reachable: no daemon, it runs in the control plane.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { RunnerKind } from "../shared/enums.js";

const dir = mkdtempSync(join(tmpdir(), "legion-probe-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, listControlEvents, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { PROBE_PERIOD_MS, dockerProbe, probeRunners, resetProbeStateForTests, runnerReachable } =
  await import("./probe.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const R = "r-probe";
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

function reset(): void {
  db.delete(schema.controlEvents).run();
  db.delete(schema.runners).run();
  resetProbeStateForTests();
}

function runner(
  id: string,
  kind: RunnerKind,
  lastSeenAt: Date | null,
  dockerHost: string | null = null,
): void {
  db.insert(schema.runners).values({ id, name: id, kind, dockerHost, lastSeenAt }).run();
}

const row = (id = R) => db.select().from(schema.runners).where(eq(schema.runners.id, id)).get()!;
const probeEvents = () => listControlEvents({ limit: 100 }).filter((e) => e.source === "probe");

/** A probe whose switch the test holds: the executor is injected, `docker-exec` is not replaced. */
function answering(answers: Record<string, boolean>, seen: string[] = []) {
  return async (r: { kind: string; dockerHost: string | null }) => {
    seen.push(r.dockerHost ?? "local");
    return answers[r.dockerHost ?? "local"]
      ? { ok: true as const }
      : { ok: false as const, why: "daemon muet" };
  };
}

describe("dockerProbe: what is not queried", () => {
  it("a `process` runner answers yes without calling docker", async () => {
    assert.deepEqual(await dockerProbe({ kind: RUNNER_KIND.process, dockerHost: null }), {
      ok: true,
    });
  });

  it("LEGION_INFRA_FAKE=1 answers yes: UI dev without a daemon stays possible", async () => {
    process.env.LEGION_INFRA_FAKE = "1";
    try {
      assert.deepEqual(
        await dockerProbe({ kind: RUNNER_KIND.docker, dockerHost: "ssh://nowhere" }),
        { ok: true },
      );
    } finally {
      delete process.env.LEGION_INFRA_FAKE;
    }
  });
});

describe("probeRunners: the state maintains itself", () => {
  beforeEach(() => reset());

  it("each runner is probed through ITS docker_host, and an answer advances last_seen_at", async () => {
    runner("r-local", "docker", null, null);
    runner("r-mini", "docker", null, "ssh://mac-mini");
    const seen: string[] = [];
    await probeRunners({
      now: T0,
      probe: answering({ local: true, "ssh://mac-mini": true }, seen),
    });

    assert.deepEqual(seen.sort(), ["local", "ssh://mac-mini"]);
    assert.equal(row("r-local").lastSeenAt?.getTime(), T0);
    assert.equal(row("r-mini").lastSeenAt?.getTime(), T0);
  });

  it("silence does not erase the last answer: it carries the hysteresis", async () => {
    runner(R, "docker", new Date(T0));
    await probeRunners({ now: T0 + PROBE_PERIOD_MS, probe: answering({}) });
    assert.equal(row().lastSeenAt?.getTime(), T0, "the date stays that of the last REAL answer");
  });

  it("stops answering → unreachable on the second round, and the log gets ONE line", async () => {
    runner(R, "docker", null);
    // Round 1: it answers. First known verdict, nothing to announce.
    await probeRunners({ now: T0, probe: answering({ local: true }) });
    assert.equal(runnerReachable(row(), T0), true);
    assert.equal(probeEvents().length, 0, "the first verdict is not a transition");

    // Round 2: silence. One period only: still reachable, nothing logged.
    await probeRunners({ now: T0 + PROBE_PERIOD_MS, probe: answering({}) });
    assert.equal(runnerReachable(row(), T0 + PROBE_PERIOD_MS), true);
    assert.equal(probeEvents().length, 0, "a one-period hiccup does not drop the machine");

    // Round 3: still silent, two periods → unreachable, ONE line.
    await probeRunners({ now: T0 + 2 * PROBE_PERIOD_MS, probe: answering({}) });
    assert.equal(runnerReachable(row(), T0 + 2 * PROBE_PERIOD_MS), false);
    const fallen = probeEvents();
    assert.equal(fallen.length, 1);
    assert.equal(fallen[0]?.level, "warn");
    assert.match(fallen[0]?.message ?? "", /unreachable/);

    // Round 4: silence CONTINUES. Nothing new, nothing written (promise 3).
    await probeRunners({ now: T0 + 3 * PROBE_PERIOD_MS, probe: answering({}) });
    assert.equal(probeEvents().length, 1, "the ticking is not written, only the transition");

    // Round 5: it answers again on its own. A second line, only one.
    await probeRunners({ now: T0 + 4 * PROBE_PERIOD_MS, probe: answering({ local: true }) });
    assert.equal(runnerReachable(row(), T0 + 4 * PROBE_PERIOD_MS), true);
    const back = probeEvents();
    assert.equal(back.length, 2);
    assert.equal(back[0]?.level, "info", "newest first (listControlEvents sorts desc)");
    assert.match(back[0]?.message ?? "", /reachable again/);

    // Round 6: it answers again. Still two lines.
    await probeRunners({ now: T0 + 5 * PROBE_PERIOD_MS, probe: answering({ local: true }) });
    assert.equal(probeEvents().length, 2);
  });

  it("a disabled runner is not probed: `enabled: false` takes the machine out", async () => {
    runner(R, "docker", null);
    db.update(schema.runners).set({ enabled: false }).where(eq(schema.runners.id, R)).run();
    const seen: string[] = [];
    await probeRunners({ now: T0, probe: answering({ local: true }, seen) });
    assert.deepEqual(seen, []);
    assert.equal(row().lastSeenAt, null);
  });
});
