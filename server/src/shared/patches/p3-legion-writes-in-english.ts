// Gives the Legion project (slug `legion`) the rule that its repository is written in English:
// commits, pull request titles and bodies, comments, docs (17/09, the repository moved to English).
//
// A rule rather than a runner or PR-draft default, because Legion drives other projects whose
// repositories are not English; the language is the project's convention, not Legion's.
//
// The seed (`projects/seed/self.ts`) carries the same rule for new databases. This copy is frozen on
// purpose: a patch writes what was true on its date, and must not import a script that seeds on load.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { DataPatch } from "./step.js";

export const ENGLISH_RULE_NAME = "english-in-the-repository";

export const ENGLISH_RULE_CONTENT = [
  "Everything that lands in the repository is written in English: commit messages, pull request",
  "titles and bodies (`pr.md`), code comments, tests and docs.",
  "Answer the operator in the language they write in.",
].join(" ");

/** Inserts the rule into every `legion` project that does not have it yet. A project without the
 *  slug is not Legion's own and is left alone; an existing rule of that name, edited or not, wins. */
export function addEnglishRule(sqlite: Database.Database, now = Date.now()): number {
  const projects = sqlite
    .prepare(
      `SELECT p.id FROM projects p
       WHERE p.slug = 'legion'
         AND NOT EXISTS (SELECT 1 FROM rules r WHERE r.project_id = p.id AND r.name = ?)`,
    )
    .all(ENGLISH_RULE_NAME) as { id: string }[];
  const insert = sqlite.prepare(
    `INSERT INTO rules (id, project_id, name, content, all_agents, status, created_at)
     VALUES (?, ?, ?, ?, 1, 'active', ?)`,
  );
  for (const { id } of projects)
    insert.run(
      randomBytes(8).toString("base64url"),
      id,
      ENGLISH_RULE_NAME,
      ENGLISH_RULE_CONTENT,
      now,
    );
  return projects.length;
}

export const p3LegionWritesInEnglish: DataPatch = {
  id: "p3-legion-writes-in-english",
  apply: (sqlite) => {
    addEnglishRule(sqlite);
  },
};
