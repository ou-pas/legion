// Protects:
//
//  1. a written event reads back as-is (level, source, message, JSON payload);
//  2. the level filter returns only that level, newest first;
//  3. rotation never keeps more than CONTROL_EVENTS_RETENTION rows, and keeps the newest.
//
// Real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

// `db.ts` reads LEGION_DB at import: set it before the first dynamic import.
const dir = mkdtempSync(join(tmpdir(), "legion-control-log-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { CONTROL_EVENTS_RETENTION, listControlEvents, logControlEvent } = await import("./db.js");
const { CONTROL_LEVEL } = await import("./enums.js");

describe("logControlEvent / listControlEvents", () => {
  it("writes an event and reads it back with its payload", () => {
    logControlEvent("info", "test", "a message", { key: "value", n: 3 });
    const [latest] = listControlEvents({ limit: 1 });
    assert.equal(latest!.level, "info");
    assert.equal(latest!.source, "test");
    assert.equal(latest!.message, "a message");
    assert.deepEqual(latest!.payload, { key: "value", n: 3 });
    assert.equal(typeof latest!.createdAt, "number");
  });

  it("returns null for a missing payload, not 'undefined' or an empty string", () => {
    logControlEvent("warn", "test", "no payload");
    const [latest] = listControlEvents({ limit: 1 });
    assert.equal(latest!.payload, null);
  });

  it("filters by level", () => {
    logControlEvent("error", "test-filter", "error A");
    logControlEvent("info", "test-filter", "info A");
    logControlEvent("error", "test-filter", "error B");
    const errors = listControlEvents({ level: CONTROL_LEVEL.error, limit: 100 }).filter(
      (e) => e.source === "test-filter",
    );
    assert.equal(errors.length, 2);
    assert.ok(errors.every((e) => e.level === CONTROL_LEVEL.error));
  });

  it("returns newest first", () => {
    logControlEvent("info", "test-order", "first");
    logControlEvent("info", "test-order", "second");
    const rows = listControlEvents({ limit: 100 }).filter((e) => e.source === "test-order");
    assert.deepEqual(
      rows.map((r) => r.message),
      ["second", "first"],
    );
  });

  it("rotation never keeps more than CONTROL_EVENTS_RETENTION rows, and keeps the newest", () => {
    // Overshoot comfortably to check the steady state, not just the crossing.
    const over = 50;
    for (let i = 0; i < CONTROL_EVENTS_RETENTION + over; i++)
      logControlEvent("info", "test-rotation", `event ${i}`);
    const all = listControlEvents({ limit: 1000 });
    assert.ok(
      all.length <= CONTROL_EVENTS_RETENTION,
      `expected <= ${CONTROL_EVENTS_RETENTION}, found ${all.length}`,
    );
    assert.equal(all[0]!.message, `event ${CONTROL_EVENTS_RETENTION + over - 1}`);
    assert.ok(!all.some((e) => e.message === "event 0"));
  });

  it("bounds limit (never 0, never > 1000)", () => {
    logControlEvent("info", "test-limit", "x");
    assert.ok(listControlEvents({ limit: 0 }).length >= 1);
    assert.ok(listControlEvents({ limit: 5000 }).length <= 1000);
  });
});
