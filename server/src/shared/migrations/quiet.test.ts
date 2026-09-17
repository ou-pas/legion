// Test command output is bounded (slice 08). Each migration used to print a line; across the
// suite's temporary databases that was 2 200 of the 10 900 lines `pnpm test` poured into an
// agent's window.
//
// Two halves, both required:
//   1. a database opened by a test prints nothing;
//   2. a real boot still says what it applied: one terminal line and a control plane event.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

// `db.ts` reads LEGION_DB at import: set it before the first dynamic import.
const dir = mkdtempSync(join(tmpdir(), "legion-migrations-"));
process.env.LEGION_DB = join(dir, "boot.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { listControlEvents } = await import("../db.js");
const { runMigrations } = await import("./index.js");

/** Replays all migrations on a fresh database, capturing stdout (where `shared/log.ts` writes).
 *  The capture window is synchronous, so node:test's reporter cannot slip in. */
function migrateCapturingStdout(name: string): { lines: string[]; from: number; to: number } {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => (
    lines.push(String(chunk).trimEnd()),
    true
  );
  try {
    const sqlite = new Database(join(dir, name));
    const result = runMigrations(sqlite);
    sqlite.close();
    return { lines, ...result };
  } finally {
    process.stdout.write = original;
  }
}

describe("migration log", () => {
  it("prints nothing for a database opened by a test", () => {
    const { lines, from, to } = migrateCapturingStdout("silence.db");
    assert.equal(from, 0);
    assert.ok(to >= 46, `the fresh database must reach the last version, not v${to}`);
    assert.deepEqual(lines, [], `expected no output, got:\n${lines.join("\n")}`);
  });

  it("prints one line on a non-test boot", () => {
    // Remove `NODE_TEST_CONTEXT` (set by node:test) to act as a real boot, then restore it.
    const context = process.env.NODE_TEST_CONTEXT;
    assert.ok(context, "node:test must set NODE_TEST_CONTEXT, or the guard does not hold");
    delete process.env.NODE_TEST_CONTEXT;
    try {
      const { lines, to } = migrateCapturingStdout("chatty.db");
      assert.equal(lines.length, 1, `one line expected, got:\n${lines.join("\n")}`);
      assert.match(lines[0]!, new RegExp(`v0 → v${to}`), "the line must name the applied range");
    } finally {
      process.env.NODE_TEST_CONTEXT = context;
    }
  });

  it("leaves a control_events trace of what the boot applied", () => {
    // This process's database was migrated at `db.ts` import, silently, but the event must exist.
    const summaries = listControlEvents({ limit: 50 }).filter(
      (e) => e.source === "db" && e.message.includes("migrations applied"),
    );
    assert.equal(summaries.length, 1, "one migration summary per boot");
    assert.match(summaries[0]!.message, /v0 → v\d+/);
  });
});
