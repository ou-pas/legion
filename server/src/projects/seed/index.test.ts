// The seed is the only code that writes to the database unasked. It killed the server on 20/08: the
// database had just been cleaned by hand, the "Default" project was gone, so `seed()` recreated it
// and reinserted the "local" runner, whose name is UNIQUE. Constraint violated mid-boot, process
// dead, and a server that does not restart does not say why.
//
// Real temporary database, not a mock: boot behaviour lives in PRAGMAs, constraints and insert order.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

// `db.ts` reads LEGION_DB at import: set it before the first dynamic import.
const dir = mkdtempSync(join(tmpdir(), "legion-seed-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { seed } = await import("./index.js");

const projects = () => db.select().from(schema.projects).all();
const runners = () => db.select().from(schema.runners).all();
const agents = () => db.select().from(schema.agents).all();

describe("seed", () => {
  it("seeds an empty database: a project, an agent, a runner", () => {
    seed();
    assert.equal(projects().length, 1);
    assert.equal(projects()[0]!.slug, "default");
    assert.equal(runners().length, 1, "un seul runner");
    assert.ok(agents().length >= 1);
  });

  it("is idempotent: a second boot duplicates nothing", () => {
    const before = { p: projects().length, r: runners().length, a: agents().length };
    seed();
    assert.deepEqual({ p: projects().length, r: runners().length, a: agents().length }, before);
  });

  it("does not resurrect a deleted project, and does not break boot", () => {
    // Replay what project deletion does (purge.ts), in foreign-key order, then reboot.
    db.delete(schema.taskTemplates).run();
    db.delete(schema.agents).run();
    db.delete(schema.environments).run();
    db.delete(schema.projects).run();
    assert.equal(projects().length, 0, "precondition: the database has no project left");

    assert.doesNotThrow(() => seed(), "boot must not throw: that is what killed the server");
    assert.equal(projects().length, 0, "no project must reappear");
    assert.equal(runners().length, 1, "et surtout pas un second runner « local »");
  });

  it("reinstalls the runner if missing: a control plane without a runner launches nothing", () => {
    db.delete(schema.runners).run();
    seed();
    assert.equal(runners().length, 1);
    assert.equal(runners()[0]!.name, "local");
    assert.equal(projects().length, 0, "the runner does not drag a project along");
  });
});
