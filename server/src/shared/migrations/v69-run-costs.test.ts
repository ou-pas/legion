// What v69 repairs (a session's cost overwritten by each run, while the SDK bills each `query()`)
// and what it must not damage: a session with one `result`, or none, must stay intact.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v69-"));
process.env.LEGION_DB = join(dir, "unused.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { steps: s1 } = await import("./v1-v10.js");
const { steps: s11 } = await import("./v11-v20.js");
const { steps: s21 } = await import("./v21-v30.js");
const { steps: s31 } = await import("./v31-v40.js");
const { steps: s41 } = await import("./v41-v45.js");
const { steps: s46 } = await import("./v46-v50.js");
const { steps: s51 } = await import("./v51-v55.js");
const { steps: s56 } = await import("./v56-v60.js");
const { steps: s61 } = await import("./v61-v65.js");
const { steps: s66, v69 } = await import("./v66-v70.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61, ...s66];

/** A database at v68. */
function baseAt68(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= 68) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    68,
    "precondition: the database must be at v68",
  );
  sqlite.exec(`
INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'p', 'p', 0);
INSERT INTO agents (id, project_id, name, role_prompt, created_at) VALUES ('a', 'p', 'a', 'r', 0);
INSERT INTO runners (id, name, kind) VALUES ('r', 'r', 'local');
INSERT INTO tasks (id, project_id, name, status, created_at, updated_at) VALUES ('t', 'p', 't', 'doing', 0, 0);
`);
  return sqlite;
}

/** A session with the cost the overwrite left, then one `result` per run. */
function seedSession(sqlite: Database.Database, id: string, stored: number, runs: number[]): void {
  sqlite
    .prepare(
      `INSERT INTO sessions (id, task_id, agent_id, runner_id, model, callback_token, cost_usd, started_at)
       VALUES (?, 't', 'a', 'r', 'm', ?, ?, 0)`,
    )
    .run(id, id, stored);
  for (const cost of runs)
    sqlite
      .prepare(
        "INSERT INTO session_events (session_id, type, payload, created_at) VALUES (?, 'result', ?, 0)",
      )
      .run(id, JSON.stringify({ subtype: "success", costUsd: cost }));
}

const costOf = (sqlite: Database.Database, id: string): number | null =>
  (
    sqlite.prepare("SELECT cost_usd AS c FROM sessions WHERE id = ?").get(id) as {
      c: number | null;
    }
  ).c;

describe("v69, lost cost of resumed sessions", () => {
  it("sums a resumed session's runs", () => {
    const sqlite = baseAt68("resumed.db");
    // The three runs measured on `RPXUHq0upSK-`; the row held only the last.
    seedSession(sqlite, "resumed", 3.4044492, [0.941514, 0, 3.4044492]);
    v69(sqlite);
    assert.equal(costOf(sqlite, "resumed"), 4.3459632);
    sqlite.close();
  });

  it("leaves a single-run session intact", () => {
    const sqlite = baseAt68("simple.db");
    seedSession(sqlite, "simple", 2.8189376, [2.8189376]);
    v69(sqlite);
    assert.equal(costOf(sqlite, "simple"), 2.8189376);
    sqlite.close();
  });

  it("leaves intact a session with no remaining `result`", () => {
    // Seen once (`kin2THXxm5nO`): summing would write NULL and erase a real cost.
    const sqlite = baseAt68("no-trace.db");
    seedSession(sqlite, "no-trace", 1.6338195, []);
    v69(sqlite);
    assert.equal(costOf(sqlite, "no-trace"), 1.6338195);
    sqlite.close();
  });

  it("sets the version and replays without doubling", () => {
    const sqlite = baseAt68("version.db");
    seedSession(sqlite, "replayed", 3, [1, 2, 3]);
    v69(sqlite);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 69);
    v69(sqlite);
    assert.equal(costOf(sqlite, "replayed"), 6, "the sum of the same runs, not double");
    sqlite.close();
  });
});
