// What v63 fills in (`Agent` for explicit tool lists) and what it must not overwrite: a hand-chosen
// list must be neither reordered nor duplicated.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v63-"));
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
const { steps: s61, v63 } = await import("./v61-v65.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61];

/** A database at v62. */
function baseAt62(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= 62) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    62,
    "precondition: the database must be at v62",
  );
  return sqlite;
}

/** An agent with the given list (`null` for an unset column); the project first (foreign key). */
function seedAgent(sqlite: Database.Database, id: string, allowedTools: string | null): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, slug, created_at) VALUES ('p', 'p', 'p', 0)",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO agents (id, project_id, name, role_prompt, created_at, allowed_tools) VALUES (?, 'p', ?, 'r', 0, ?)",
    )
    .run(id, id, allowedTools);
}

const toolsOf = (sqlite: Database.Database, id: string): string | null =>
  (
    sqlite.prepare("SELECT allowed_tools AS t FROM agents WHERE id = ?").get(id) as {
      t: string | null;
    }
  ).t;

describe("v63, Agent for everyone", () => {
  it("appends Agent to an explicit list without it", () => {
    const sqlite = baseAt62("append.db");
    const before = JSON.stringify(["Bash", "Read", "WebSearch"]);
    seedAgent(sqlite, "interviewer", before);
    v63(sqlite);
    assert.deepEqual(JSON.parse(toolsOf(sqlite, "interviewer")!), [
      "Bash",
      "Read",
      "WebSearch",
      "Agent",
    ]);
    sqlite.close();
  });

  it("leaves a list that already has it: no duplicate", () => {
    const sqlite = baseAt62("idempotent.db");
    seedAgent(sqlite, "already", JSON.stringify(["Agent", "Bash"]));
    v63(sqlite);
    assert.deepEqual(JSON.parse(toolsOf(sqlite, "already")!), ["Agent", "Bash"]);
    sqlite.close();
  });

  it("leaves a NULL column NULL: the code serves it", () => {
    const sqlite = baseAt62("null.db");
    seedAgent(sqlite, "default", null);
    v63(sqlite);
    assert.equal(
      toolsOf(sqlite, "default"),
      null,
      "writing a list here would freeze what must follow DEFAULT_TOOLS",
    );
    sqlite.close();
  });

  it("sets the version and replays harmlessly", () => {
    const sqlite = baseAt62("version.db");
    seedAgent(sqlite, "replayed", JSON.stringify(["Bash"]));
    v63(sqlite);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 63);
    v63(sqlite);
    assert.deepEqual(JSON.parse(toolsOf(sqlite, "replayed")!), ["Bash", "Agent"]);
    sqlite.close();
  });
});
