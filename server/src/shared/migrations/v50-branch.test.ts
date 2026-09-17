// What v50 must not lose (nav slice 15). A task's branch moves from derivation to a column. Three
// readers reread the branch after work was pushed (review diff, PR opening, wait wake-up): a task
// that already ran and got a new branch would show an empty diff and a PR without commits,
// silently. Replays the migration on a v49 database and checks the task keeps exactly its branch.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v50-"));
process.env.LEGION_DB = join(dir, "unused.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { steps: s1 } = await import("./v1-v10.js");
const { steps: s11 } = await import("./v11-v20.js");
const { steps: s21 } = await import("./v21-v30.js");
const { steps: s31 } = await import("./v31-v40.js");
const { steps: s41 } = await import("./v41-v45.js");
const { steps: s46 } = await import("./v46-v50.js");
const { HEAD_VERSION, runMigrations } = await import("./index.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46];

/** A database at v49. */
function baseAt49(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= 49) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    49,
    "precondition: the database must be at v49",
  );
  return sqlite;
}

describe("v50, branch migration", () => {
  it("gives a task that already ran the exact branch it pushed to", () => {
    const sqlite = baseAt49("launched.db");
    const now = Date.now();
    sqlite.exec(`
INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', ${now});
INSERT INTO agents (id, project_id, name, role_prompt, created_at) VALUES ('a', 'p', 'a', 'r', ${now});
INSERT INTO runners (id, name, kind) VALUES ('r', 'r', 'process');
INSERT INTO tasks (id, project_id, name, status, created_at, updated_at)
  VALUES ('pushed', 'p', 'A task already pushed', 'review', ${now}, ${now});
INSERT INTO tasks (id, project_id, name, status, created_at, updated_at)
  VALUES ('never', 'p', 'A task never run', 'todo', ${now}, ${now});
INSERT INTO tasks (id, project_id, name, status, template_run_id, created_at, updated_at)
  VALUES ('step', 'p', 'Step 1/2', 'done', 'run-4', ${now}, ${now});
INSERT INTO sessions (id, task_id, agent_id, runner_id, model, callback_token, started_at)
  VALUES ('s1', 'pushed', 'a', 'r', 'sonnet', 't', ${now});
INSERT INTO sessions (id, task_id, agent_id, runner_id, model, callback_token, started_at)
  VALUES ('s2', 'step', 'a', 'r', 'sonnet', 't', ${now});
`);

    runMigrations(sqlite);
    // Read, not hardcoded: this test guards the branch backfill, not today's version.
    assert.equal(sqlite.pragma("user_version", { simple: true }), HEAD_VERSION);

    const branchOf = (id: string) =>
      sqlite.prepare("SELECT branch, type FROM tasks WHERE id = ?").get(id) as {
        branch: string | null;
        type: string;
      };

    assert.equal(branchOf("pushed").branch, "legion/pushed", "the previous branch, exactly");
    // A run scope wins over the id, as in `taskRunScope`: that is where the branch lived.
    assert.equal(branchOf("step").branch, "legion/run-4");
    assert.equal(
      branchOf("never").branch,
      null,
      "nothing pushed, nothing to keep: conventional name at first derivation",
    );
    assert.equal(branchOf("never").type, "chore", "the default type is the honest fallback");
    sqlite.close();
  });

  it("touches nothing on a database without sessions", () => {
    const sqlite = baseAt49("empty.db");
    const now = Date.now();
    sqlite.exec(`
INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', ${now});
INSERT INTO tasks (id, project_id, name, status, created_at, updated_at)
  VALUES ('t', 'p', 'Nothing', 'todo', ${now}, ${now});
`);
    runMigrations(sqlite);
    const row = sqlite.prepare("SELECT branch FROM tasks WHERE id = 't'").get() as {
      branch: string | null;
    };
    assert.equal(row.branch, null);
    sqlite.close();
  });
});
