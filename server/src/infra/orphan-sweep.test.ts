// The timed orphan sweep: which runners it cleans, and what it leaves in the control log.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-orphan-sweep-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { sweepOrphans } = await import("./orphan-sweep.js");
const { done, refuse } = await import("../http/from-result.js");

before(() => {
  const base = { dockerHost: null, lastSeenAt: new Date() };
  db.insert(schema.runners)
    .values([
      { ...base, id: "on1", name: "on", kind: RUNNER_KIND.docker, enabled: true },
      { ...base, id: "down1", name: "down", kind: RUNNER_KIND.docker, enabled: true },
      { ...base, id: "off1", name: "off", kind: RUNNER_KIND.docker, enabled: false },
      { ...base, id: "proc1", name: "proc", kind: RUNNER_KIND.process, enabled: true },
    ])
    .run();
});

describe("sweepOrphans", () => {
  it("cleans only enabled docker runners and logs what it removed", async () => {
    const called: string[] = [];
    // Migrations write their own lines at boot: only what the sweep adds counts.
    const earlier = db.select().from(schema.controlEvents).all().length;
    await sweepOrphans(async (runnerId) => {
      called.push(runnerId);
      if (runnerId === "down1") return refuse(502, "docker indisponible");
      return done({ removed: ["legion-rebuild-on1"], errors: [] });
    });
    assert.deepEqual(called.sort(), ["down1", "on1"]);

    const events = db.select().from(schema.controlEvents).all().slice(earlier);
    assert.equal(
      events.length,
      1,
      "one line for the runner that had something, none for the refusal",
    );
    assert.match(events[0]?.message ?? "", /“on”: 1 removed, 0 failed/);
    assert.equal(events[0]?.level, "info");
  });

  it("says nothing when there is nothing to clean", async () => {
    const before = db.select().from(schema.controlEvents).all().length;
    await sweepOrphans(async () => done({ removed: [], errors: [] }));
    assert.equal(db.select().from(schema.controlEvents).all().length, before);
  });
});
