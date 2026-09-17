// What v54 catches up, and what it must not touch: past kills become `cancelled`, recognised by the
// `{"killed":true}` trace `killGoal` always wrote. A real failure switched with them would lose the
// only information its row carried; both are side by side here.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v54-"));
process.env.LEGION_DB = join(dir, "unused.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { steps: s1 } = await import("./v1-v10.js");
const { steps: s11 } = await import("./v11-v20.js");
const { steps: s21 } = await import("./v21-v30.js");
const { steps: s31 } = await import("./v31-v40.js");
const { steps: s41 } = await import("./v41-v45.js");
const { steps: s46 } = await import("./v46-v50.js");
const { steps: s51 } = await import("./v51-v55.js");
const { runMigrations } = await import("./index.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51];

/** A database at v53. */
function baseAt53(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= 53) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    53,
    "precondition: the database must be at v53",
  );
  return sqlite;
}

describe("v54, cancelling is not failing", () => {
  it("switches killed goals to `cancelled` and leaves real failures `failed`", () => {
    const sqlite = baseAt53("kills.db");
    const now = Date.now();
    sqlite.exec(`
INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', ${now});
INSERT INTO goals (id, project_id, name, request, status, created_at)
  VALUES ('killed', 'p', 'Abandoned goal', 'r', 'failed', ${now});
INSERT INTO goals (id, project_id, name, request, status, created_at)
  VALUES ('broken', 'p', 'Broken goal', 'r', 'failed', ${now});
INSERT INTO goals (id, project_id, name, request, status, created_at)
  VALUES ('finished', 'p', 'Finished goal', 'r', 'completed', ${now});
INSERT INTO goal_events (goal_id, type, payload, created_at)
  VALUES ('killed', 'status', '{"status":"failed","killed":true}', ${now});
INSERT INTO goal_events (goal_id, type, payload, created_at)
  VALUES ('broken', 'status', '{"status":"failed","reason":"no allowed agents"}', ${now});
`);

    runMigrations(sqlite);

    const status = (id: string) =>
      (sqlite.prepare("SELECT status FROM goals WHERE id = ?").get(id) as { status: string })
        .status;
    assert.equal(status("killed"), "cancelled", "the goal killed by the operator");
    assert.equal(status("broken"), "failed", "the real failure keeps its status");
    assert.equal(status("finished"), "completed", "nothing else is touched");
    sqlite.close();
  });

  it("passes cleanly on a database without kills", () => {
    const sqlite = baseAt53("empty.db");
    runMigrations(sqlite);
    assert.ok((sqlite.pragma("user_version", { simple: true }) as number) >= 54);
    sqlite.close();
  });
});
