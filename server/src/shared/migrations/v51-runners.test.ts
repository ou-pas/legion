// What v51 must not break (multi-machine slice 01): the backfill. `pickRunnerRow` refuses to route
// to a NULL `last_seen_at`, so without it every existing runner would be ineligible until the first
// probe pass.
//
// This test checks the date only; what the date means for routing is tested in
// `infra/runner-reachability.test.ts` (`shared/` may not import `infra/`).
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v51-"));
process.env.LEGION_DB = join(dir, "unused.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { steps: s1 } = await import("./v1-v10.js");
const { steps: s11 } = await import("./v11-v20.js");
const { steps: s21 } = await import("./v21-v30.js");
const { steps: s31 } = await import("./v31-v40.js");
const { steps: s41 } = await import("./v41-v45.js");
const { steps: s46 } = await import("./v46-v50.js");
const { v51 } = await import("./v51-v55.js");

const BEFORE_51 = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46];

/** A v50 database with a fleet in place. */
function baseAt50(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [, apply] of BEFORE_51) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    50,
    "precondition: the database must be at v50",
  );
  sqlite.exec(`
INSERT INTO runners (id, name, kind) VALUES ('r-local', 'local', 'docker');
INSERT INTO runners (id, name, kind, docker_host) VALUES ('r-mini', 'mac-mini', 'docker', 'ssh://mini');
`);
  return sqlite;
}

describe("v51, the two fleet columns", () => {
  it("keeps an existing runner eligible right after the migration", () => {
    const sqlite = baseAt50("existing.db");
    v51(sqlite);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 51);

    const rows = sqlite
      .prepare("SELECT id, callback_url, last_seen_at FROM runners ORDER BY id")
      .all() as { id: string; callback_url: string | null; last_seen_at: number | null }[];
    assert.equal(rows.length, 2);
    const now = Date.now();
    for (const r of rows) {
      assert.equal(r.callback_url, null, "no invented address: NULL = previous behaviour");
      assert.ok(r.last_seen_at, `${r.id}: the backfill gave it a date`);
      // Dated "now" to the second, so the whole grace window remains.
      assert.ok(now - r.last_seen_at! < 5_000, `${r.id}: dated at migration time`);
      // Not in the future: the credit is a date, so it expires on its own.
      assert.ok(r.last_seen_at! <= now, `${r.id}: the backfill is not in the future`);
    }
    sqlite.close();
  });
});
