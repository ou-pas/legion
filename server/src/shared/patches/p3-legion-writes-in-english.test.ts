// p3 adds the English rule to Legion's own project, once, and to nothing else.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-p3-"));
process.env.LEGION_DB = join(dir, "unused.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { addEnglishRule, ENGLISH_RULE_NAME, ENGLISH_RULE_CONTENT } =
  await import("./p3-legion-writes-in-english.js");
const { steps: s1 } = await import("../migrations/v1-v10.js");
const { steps: s11 } = await import("../migrations/v11-v20.js");
const { steps: s21 } = await import("../migrations/v21-v30.js");
const { steps: s31 } = await import("../migrations/v31-v40.js");
const { steps: s41 } = await import("../migrations/v41-v45.js");
const { steps: s46 } = await import("../migrations/v46-v50.js");
const { steps: s51 } = await import("../migrations/v51-v55.js");
const { steps: s56 } = await import("../migrations/v56-v60.js");
const { steps: s61 } = await import("../migrations/v61-v65.js");
const { steps: s66 } = await import("../migrations/v66-v70.js");
const { steps: s71 } = await import("../migrations/v71-v75.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61, ...s66, ...s71];
let n = 0;

function freshDb(): Database.Database {
  const sqlite = new Database(join(dir, `p3-${++n}.db`));
  for (const [, apply] of ALL) apply(sqlite);
  return sqlite;
}

function project(sqlite: Database.Database, id: string, slug: string): void {
  sqlite
    .prepare("INSERT INTO projects (id, name, slug, context, created_at) VALUES (?, ?, ?, '', 1)")
    .run(id, slug, slug);
}

const englishRules = (sqlite: Database.Database) =>
  sqlite
    .prepare("SELECT project_id, content, all_agents FROM rules WHERE name = ?")
    .all(ENGLISH_RULE_NAME) as {
    project_id: string;
    content: string;
    all_agents: number;
  }[];

it("gives the Legion project the rule, for all agents, and no other project", () => {
  const sqlite = freshDb();
  project(sqlite, "self", "legion");
  project(sqlite, "client", "kopee");
  assert.equal(addEnglishRule(sqlite), 1);
  assert.deepEqual(englishRules(sqlite), [
    { project_id: "self", content: ENGLISH_RULE_CONTENT, all_agents: 1 },
  ]);
});

it("runs twice without a second rule, and keeps an edited one", () => {
  const sqlite = freshDb();
  project(sqlite, "self", "legion");
  sqlite
    .prepare(
      "INSERT INTO rules (id, project_id, name, content, created_at) VALUES ('r', 'self', ?, 'edited', 1)",
    )
    .run(ENGLISH_RULE_NAME);
  assert.equal(addEnglishRule(sqlite), 0);
  assert.equal(addEnglishRule(sqlite), 0);
  assert.deepEqual(
    englishRules(sqlite).map((r) => r.content),
    ["edited"],
  );
});

it("does nothing on a database without a Legion project", () => {
  const sqlite = freshDb();
  assert.equal(addEnglishRule(sqlite), 0);
  assert.equal(englishRules(sqlite).length, 0);
});
