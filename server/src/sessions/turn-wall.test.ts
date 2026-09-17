// The hard turn wall should no longer be reached since the automatic relaunch. So this tests the
// opposite of normal operation: that an "impossible" case leaves a warn-level trace where people
// investigate, instead of vanishing into a session end like the others.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-turn-wall-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { noteTurnWall } = await import("./turn-wall.js");

const SESSION = { id: "s1", taskId: "t1" };
const events = () => db.select().from(schema.controlEvents).all();

describe("noteTurnWall: a case that should no longer exist must show", () => {
  beforeEach(() => {
    db.delete(schema.controlEvents).run();
  });

  it("`error_max_turns` writes a warn naming the session, the task and the turn count", () => {
    noteTurnWall(SESSION, { subtype: "error_max_turns", numTurns: 201 });
    const [ev] = events();
    assert.ok(ev, "a control event must exist");
    assert.equal(ev.level, "warn");
    assert.equal(ev.source, "turns");
    assert.match(ev.message, /s1/);
    assert.match(ev.message, /201 turns/);
    assert.match(ev.message, /the automatic restart did not happen/);
    assert.deepEqual(JSON.parse(ev.payload ?? "{}"), {
      sessionId: "s1",
      taskId: "t1",
      numTurns: 201,
    });
  });

  it("an ordinary result writes nothing: the nominal path stays silent", () => {
    noteTurnWall(SESSION, { subtype: "success", numTurns: 42 });
    noteTurnWall(SESSION, { subtype: "error_during_execution" });
    noteTurnWall(SESSION, {});
    noteTurnWall(SESSION, null);
    assert.equal(events().length, 0);
  });

  it("a missing turn count does not silence the warning", () => {
    noteTurnWall(SESSION, { subtype: "error_max_turns" });
    const [ev] = events();
    assert.ok(ev);
    assert.match(ev.message, /\(\? turns\)/);
  });
});
