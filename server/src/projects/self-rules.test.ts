// The rules the seed sets, and whom they apply to.
//
// A rule checked "all agents" enters every session's system prompt with nothing to forget to invoke;
// unchecked, it sits on disk unread. That gap cost three days on 27/08 (mini skills granted to no
// agent), so the flag is checked, not assumed.
//
// Importing runs the seed (it is a script): this reads what `pnpm seed:self` writes. Rule names are
// French identifiers; contents are English since 17/09.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-self-rules-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { SELF_SLUG } = await import("./seed/self.js");

const project = db.select().from(schema.projects).where(eq(schema.projects.slug, SELF_SLUG)).get()!;
const ruleNamed = (name: string) =>
  db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.projectId, project.id), eq(schema.rules.name, name)))
    .get();

describe("the conventional branches rule", () => {
  const rule = ruleNamed("branches-conventionnelles");

  it("exists, is active, and applies to all agents", () => {
    assert.ok(rule, "the seed must set it");
    assert.equal(rule.allAgents, true, "unchecked, no prompt would carry it");
    assert.equal(rule.status, "active");
  });

  it("states the convention: the three types and the allowed alphabet", () => {
    const content = rule!.content;
    for (const type of ["feature/", "bugfix/", "chore/"])
      assert.ok(content.includes(type), `“${type}” must be named`);
    assert.match(
      content,
      /a-z, 0-9 and the hyphen/,
      "the allowed alphabet must be stated, not implied",
    );
    assert.match(content, /conventionalbranch\.org/, "the source must be citable by the agent");
  });

  it("also says not to rename the branch Legion gives", () => {
    // The half one would forget: a zealous agent renaming its branch loses the link with the task,
    // since the review diff and the PR look for the other name.
    assert.match(rule!.content, /do not rename it/i);
  });

  it("belongs to a rule set the seed does not duplicate", () => {
    // Idempotence: the seed runs at every import, so a duplicate would show here.
    const all = db.select().from(schema.rules).where(eq(schema.rules.projectId, project.id)).all();
    const names = all.map((r) => r.name);
    assert.equal(new Set(names).size, names.length, `duplicated rules: ${names.join(", ")}`);
  });
});
