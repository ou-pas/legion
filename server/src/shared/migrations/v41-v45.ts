import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { MigrationStep } from "./step.js";

// Migrations v41 → v45.

export function v41(sqlite: Database.Database): void {
  // v41: a rule knows its repositories and may have a body too large for a prompt. Defaults (`[]`,
  // `""`) keep existing rules exactly as before.
  sqlite.exec(`
BEGIN;
ALTER TABLE rules ADD COLUMN repo_names TEXT NOT NULL DEFAULT '[]';
ALTER TABLE rules ADD COLUMN summary TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 41;
COMMIT;
`);
}

export function v42(sqlite: Database.Database): void {
  // v42: the lock, off by default. No existing rule becomes locked: that is the operator's gesture.
  sqlite.exec(`
BEGIN;
ALTER TABLE rules ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 42;
COMMIT;
`);
}

export function v43(sqlite: Database.Database): void {
  // v43: discipline skills become project defaults. The 24/08 two-tier setup was half wired: the
  // "mini" skills were on disk but granted to no agent.
  //
  // `default_skill_names` (v35) is set project by project, only when still empty, so a deliberate
  // operator choice is not overwritten. Only skills present on disk are set: a default naming a
  // missing folder would be a mute setting.
  const wanted = [
    "lean-ctx",
    "domain-driven-design",
    "clean-architecture",
    "a-philosophy-of-software-design",
    "refactoring",
  ];
  const skillsDir = path.join(path.resolve(process.env.LEGION_DATA ?? "data"), "skills");
  let present: string[];
  try {
    const dirs = new Set(
      fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
    // `lean-ctx` is built in: `installBuiltinSkills()` writes it later in the same boot, so it is
    // kept even if the folder does not exist yet.
    present = wanted.filter((n) => n === "lean-ctx" || dirs.has(n));
  } catch {
    present = ["lean-ctx"];
  }
  sqlite.exec("BEGIN;");
  const rows = sqlite.prepare("SELECT id, default_skill_names FROM projects").all() as {
    id: string;
    default_skill_names: string;
  }[];
  const set = sqlite.prepare("UPDATE projects SET default_skill_names = ? WHERE id = ?");
  for (const r of rows) {
    let current: unknown;
    try {
      current = JSON.parse(r.default_skill_names);
    } catch {
      current = null;
    }
    if (Array.isArray(current) && current.length > 0) continue; // un choix existant reste
    set.run(JSON.stringify(present), r.id);
  }
  sqlite.exec("PRAGMA user_version = 43; COMMIT;");
}

export function v44(sqlite: Database.Database): void {
  // v44: dependencies become a graph, expand phase. `tasks.blocked_by_task_id` holds one blocker,
  // but a batch's slices all block the Wiki step. The join table is created next to the column and
  // filled; readers still read the column, writers keep both in sync (tasks/blockers.ts).
  //
  // The column never had a FK, so a vanished blocker is cleaned rather than copied (the new FK
  // would reject it, and a task blocked by a ghost was never picked anyway).
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS task_blockers (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, blocker_id));
CREATE INDEX IF NOT EXISTS idx_task_blockers_blocker ON task_blockers(blocker_id);
UPDATE tasks SET blocked_by_task_id = NULL
  WHERE blocked_by_task_id IS NOT NULL AND blocked_by_task_id NOT IN (SELECT id FROM tasks);
INSERT INTO task_blockers (task_id, blocker_id, created_at)
  SELECT id, blocked_by_task_id, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tasks WHERE blocked_by_task_id IS NOT NULL;
PRAGMA user_version = 44;
COMMIT;
`);
}

export function v45(sqlite: Database.Database): void {
  // v45: dependencies are a graph, contract phase. Readers and writers moved to `task_blockers`, so
  // the old column is dropped.
  //
  // `DROP COLUMN` (SQLite ≥ 3.35.0; better-sqlite3 12 ships 3.53) rather than rebuilding the table:
  // no index, FK or constraint references the column, and a rebuild would have to restate
  // `tasks`' indexes and FKs. `blockers.test.ts` checks the SQLite version.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks DROP COLUMN blocked_by_task_id;
PRAGMA user_version = 45;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [41, v41],
  [42, v42],
  [43, v43],
  [44, v44],
  [45, v45],
];
