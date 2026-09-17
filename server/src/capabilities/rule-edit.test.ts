// Protects:
//
//  1. Upsert by (project, name): re-dropping the same .md file updates the rule.
//  2. An upsert never unlocks a rule; globs do update.
//  3. Scope is checked against real repositories; an unknown name is refused by name.
//  4. Globs stay inside the workspace, capped in count and length.
//  5. Deleting a rule clears its grants.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-rule-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { deleteRule, editRule, listRules, upsertRule } = await import("./rule-edit.js");

const P1 = "p1";
const P2 = "p2";

beforeEach(() => {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.rules).run();
  db.delete(schema.repos).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now },
      { id: P2, name: "P2", slug: "p2", createdAt: now },
    ])
    .run();
  db.insert(schema.repos)
    .values([
      {
        id: "repo-1",
        projectId: P1,
        name: "api",
        url: "https://example.test/api.git",
        createdAt: now,
      },
      {
        id: "repo-2",
        projectId: P1,
        name: "web",
        url: "https://example.test/web.git",
        createdAt: now,
      },
    ])
    .run();
});

const base = { projectId: P1, name: "conventions", content: "always write tests" };
const ruleById = (id: string) =>
  db.select().from(schema.rules).where(eq(schema.rules.id, id)).get();

describe("upsertRule, adding a rule", () => {
  it("creates the rule with the widest scope by default", () => {
    const result = upsertRule({ ...base });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.rule.repoNames, "[]");
    assert.equal(result.rule.paths, "[]");
    assert.equal(result.rule.status, "active");
  });

  it("updates on the same name instead of creating a twin", () => {
    const first = upsertRule({ ...base });
    assert.equal(first.ok, true);
    const second = upsertRule({ ...base, content: "version 2" });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.rule.id, first.rule.id);
    assert.equal(listRules(P1).length, 1);
    assert.equal(ruleById(first.rule.id)?.content, "version 2");
  });

  it("treats the same name in another project as another rule", () => {
    upsertRule({ ...base });
    const other = upsertRule({ ...base, projectId: P2 });
    assert.equal(other.ok, true);
    assert.equal(other.created, true);
    assert.equal(listRules(undefined).length, 2);
  });

  it("does not unlock a locked rule on re-upload", () => {
    const locked = upsertRule({ ...base, locked: true });
    assert.equal(locked.ok, true);
    upsertRule({ ...base, content: "other", locked: false });
    assert.equal(ruleById(locked.rule.id)?.locked, true);
  });

  it("updates globs on re-upload: they say when the rule applies", () => {
    const first = upsertRule({ ...base, paths: ["src/**/*.ts"] });
    assert.equal(first.ok, true);
    upsertRule({ ...base, paths: ["docs/**"] });
    assert.deepEqual(JSON.parse(ruleById(first.rule.id)?.paths ?? "[]"), ["docs/**"]);
  });

  it("refuses a repository unknown to the project, naming it", () => {
    const result = upsertRule({ ...base, repoNames: ["api", "ghost"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /ghost/);
    assert.equal(listRules(P1).length, 0);
  });

  it("accepts the project's repositories, deduplicated and trimmed", () => {
    const result = upsertRule({ ...base, repoNames: [" api ", "api", "web"] });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(result.rule.repoNames), ["api", "web"]);
  });

  it("accepts an empty repository list: the rule applies everywhere", () => {
    const result = upsertRule({ ...base, repoNames: [] });
    assert.equal(result.ok, true);
    assert.equal(result.rule.repoNames, "[]");
  });
});

describe("upsertRule, globs stay inside the workspace", () => {
  it("refuses an absolute path", () => {
    const result = upsertRule({ ...base, paths: ["/etc/passwd"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /outside the session workspace/);
  });

  it("refuses a `..` climb", () => {
    const result = upsertRule({ ...base, paths: ["../elsewhere/**"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /outside the session workspace/);
  });

  it("refuses more than twenty patterns", () => {
    const paths = Array.from({ length: 21 }, (_, i) => `src/${i}/**`);
    const result = upsertRule({ ...base, paths });
    assert.equal(result.ok, false);
    assert.match(result.error, /20 patterns/);
  });

  it("refuses a pattern that is too long", () => {
    const result = upsertRule({ ...base, paths: [`src/${"a".repeat(300)}`] });
    assert.equal(result.ok, false);
    assert.match(result.error, /too long/);
  });
});

describe("editRule, editing from the screen", () => {
  it("404 on an unknown rule", () => {
    assert.deepEqual(editRule("never", { name: "x" }), {
      ok: false,
      status: 404,
      error: "rule not found",
    });
  });

  it("writes only the fields present in the body", () => {
    const created = upsertRule({ ...base, summary: "summary", allAgents: true });
    assert.equal(created.ok, true);
    assert.equal(editRule(created.rule.id, { content: "  other  " }).ok, true);
    const row = ruleById(created.rule.id);
    assert.equal(row?.content, "other");
    assert.equal(row?.summary, "summary");
    assert.equal(row?.allAgents, true);
  });

  it("changes lock and status here, a human gesture", () => {
    const created = upsertRule({ ...base });
    assert.equal(created.ok, true);
    assert.equal(editRule(created.rule.id, { locked: true, status: "suggested" }).ok, true);
    assert.equal(ruleById(created.rule.id)?.locked, true);
    assert.equal(ruleById(created.rule.id)?.status, "suggested");
  });

  it("checks the edited scope against the rule's own project repositories", () => {
    const created = upsertRule({ ...base });
    assert.equal(created.ok, true);
    const result = editRule(created.rule.id, { repoNames: ["ghost"] });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });
});

describe("deleteRule, no ghost grant", () => {
  it("removes the rule from referencing agents before deleting it", () => {
    const created = upsertRule({ ...base });
    assert.equal(created.ok, true);
    db.insert(schema.agents)
      .values({
        id: "a1",
        projectId: P1,
        name: "a",
        rolePrompt: "r",
        createdAt: new Date(),
        ruleIds: JSON.stringify([created.rule.id, "other"]),
      })
      .run();
    deleteRule(created.rule.id);
    assert.equal(ruleById(created.rule.id), undefined);
    const agent = db.select().from(schema.agents).where(eq(schema.agents.id, "a1")).get();
    assert.deepEqual(JSON.parse(agent?.ruleIds ?? "[]"), ["other"]);
  });
});
