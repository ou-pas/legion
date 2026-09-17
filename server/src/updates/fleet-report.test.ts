// Fleet image results from an update log, surfaced in the control log (07/09): the control plane
// rereads the finished file and records one event per log, once.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { parseFleetOutcome, reportFinishedLogs, type ReportedEvent } from "./fleet-report.js";

const dir = mkdtempSync(join(tmpdir(), "legion-fleet-report-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const UPDATE_LOG = `[2026-09-07T09:51:30Z] Updating to v0.22.1 (Docker mode, container legion-update).
[2026-09-07T09:53:10Z] — fleet images: rebuild towards 2 ssh:// runner(s)
[2026-09-07T09:53:11Z]   → session image on mini-atelier (ssh://operator@100.64.0.11)
#17 24.26 ✓ built in 7.54s
[2026-09-07T09:53:15Z]   ✓ mini-atelier: session image up to date
[2026-09-07T09:53:15Z]   ✓ mini-atelier: browser image up to date
[2026-09-07T09:53:15Z]   ✓ mini-atelier: proxy image up to date
[2026-09-07T09:53:17Z]   → session image on portable-atelier (ssh://operator@100.64.0.12)
ERROR: error during connect: ssh: connect to host 100.64.0.12 port 22: Operation timed out
[2026-09-07T09:53:47Z]   ⛔ portable-atelier: session image — rebuild failed, no consequence for this update; a manual “make image-session” will catch up
[2026-09-07T09:55:22Z]   ⛔ portable-atelier: browser image — rebuild failed, no consequence for this update; a manual “make image-browser” will catch up
[2026-09-07T09:57:05Z]   ✓ portable-atelier: proxy image up to date
[2026-09-07T09:57:05Z] ✓ done.
`;

describe("parseFleetOutcome: read the log, do not guess", () => {
  it("collects each verdict per machine and image, and knows the log is finished", () => {
    const o = parseFleetOutcome(UPDATE_LOG);
    assert.equal(o.complete, true);
    assert.equal(o.target, "v0.22.1");
    assert.deepEqual(o.results, [
      { runner: "mini-atelier", image: "session image", ok: true },
      { runner: "mini-atelier", image: "browser image", ok: true },
      { runner: "mini-atelier", image: "proxy image", ok: true },
      { runner: "portable-atelier", image: "session image", ok: false },
      { runner: "portable-atelier", image: "browser image", ok: false },
      { runner: "portable-atelier", image: "proxy image", ok: true },
    ]);
  });

  it('a log without "done" is not finished: nothing concluded yet', () => {
    const o = parseFleetOutcome(UPDATE_LOG.replace("✓ done.\n", ""));
    assert.equal(o.complete, false);
  });

  it("an on-demand rebuild uses the same vocabulary, without a version tag", () => {
    const o = parseFleetOutcome(
      "[t] Rebuilding image(s) on portable-atelier, on request.\n[t]   ✓ portable-atelier: session image up to date\n[t] ✓ done.\n",
    );
    assert.equal(o.target, null);
    assert.deepEqual(o.results, [{ runner: "portable-atelier", image: "session image", ok: true }]);
  });
});

describe("reportFinishedLogs: one event per finished log, once", () => {
  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });

  function collect() {
    const events: ReportedEvent[] = [];
    return {
      events,
      emit: (e: ReportedEvent) => {
        events.push(e);
      },
    };
  }

  it("a per-machine failure becomes a warning NAMING the machine and the image", () => {
    writeFileSync(join(dir, "2026-09-07T09-51-29-128Z.log"), UPDATE_LOG);
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.level, "warn");
    assert.equal(events[0]!.source, "update");
    assert.match(events[0]!.message, /v0\.22\.1/);
    assert.match(events[0]!.message, /portable-atelier/);
    assert.match(events[0]!.message, /session image/);
    assert.doesNotMatch(events[0]!.message, /mini-atelier[^·]*⛔/);
  });

  it("all up to date: info, not a warning", () => {
    writeFileSync(
      join(dir, "a.log"),
      UPDATE_LOG.replace(
        /⛔ portable-atelier: (session|browser) image — rebuild failed[^\n]*/g,
        "✓ portable-atelier: $1 image up to date",
      ),
    );
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    assert.equal(events[0]!.level, "info");
  });

  it("the same log is not reported twice: a marker stays next to it", () => {
    writeFileSync(join(dir, "a.log"), UPDATE_LOG);
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    reportFinishedLogs(dir, emit);
    assert.equal(events.length, 1);
    assert.ok(existsSync(join(dir, "a.log.reported")));
  });

  it("an unfinished log waits: without a marker it is reread next round", () => {
    writeFileSync(join(dir, "a.log"), UPDATE_LOG.replace("✓ done.\n", ""));
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    assert.equal(events.length, 0);
    assert.ok(!existsSync(join(dir, "a.log.reported")));
  });

  it('an on-demand rebuild is reported under "infra", naming the machine', () => {
    writeFileSync(
      join(dir, "rebuild-r1-2026.log"),
      "[t] Rebuilding image(s) on portable-atelier, on request.\n[t]   ✓ portable-atelier: session image up to date\n[t] ✓ done.\n",
    );
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    assert.equal(events[0]!.source, "infra");
    assert.equal(events[0]!.level, "info");
    assert.match(events[0]!.message, /portable-atelier/);
  });

  it("logs from BEFORE this feature (over a day old) are marked silently", () => {
    const old = join(dir, "old.log");
    writeFileSync(old, UPDATE_LOG);
    const twoDaysAgo = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    assert.equal(events.length, 0);
    assert.ok(existsSync(`${old}.reported`));
  });

  it("a finished log without any fleet line makes no event: nothing to say", () => {
    writeFileSync(join(dir, "a.log"), "[t] Updating to v0.1.0 (Docker mode).\n[t] ✓ done.\n");
    const { events, emit } = collect();
    reportFinishedLogs(dir, emit);
    assert.equal(events.length, 0);
    assert.ok(existsSync(join(dir, "a.log.reported")));
  });

  it("a missing folder is not an error", () => {
    const { events, emit } = collect();
    reportFinishedLogs(join(dir, "nope"), emit);
    assert.equal(events.length, 0);
  });
});
