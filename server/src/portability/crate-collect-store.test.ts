// A crate must never carry another project's row, and the project filter in these queries is what
// guarantees it, not the code that composes the crate.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-crate-collect-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentRowsOf,
  environmentRowsOf,
  mcpServerRowsOf,
  projectRow,
  repoRowsOf,
  ruleRowsOf,
  secretRowsOf,
  taskTemplateRowsOf,
} = await import("./crate-collect-store.js");

const now = new Date();
const projects: [string, string][] = [
  ["p1", "one"],
  ["p2", "two"],
];
for (const [id, slug] of projects)
  db.insert(schema.projects).values({ id, name: id, slug, createdAt: now }).run();

for (const projectId of ["p1", "p2"]) {
  const s = projectId === "p1" ? "" : "-bis";
  db.insert(schema.environments)
    .values({ id: `env${s}`, projectId, name: `env${s}`, networking: "open", allowedHosts: "[]" })
    .run();
  db.insert(schema.agents)
    .values({ id: `a${s}`, projectId, name: `dev${s}`, rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.repos)
    .values({
      id: `r${s}`,
      projectId,
      name: `repo${s}`,
      url: "https://git.test/o/r",
      createdAt: now,
    })
    .run();
  db.insert(schema.rules)
    .values({ id: `ru${s}`, projectId, name: `rule${s}`, content: "c", createdAt: now })
    .run();
  db.insert(schema.mcpServers)
    .values({ id: `m${s}`, projectId, name: `mcp${s}`, config: "{}", createdAt: now })
    .run();
  db.insert(schema.taskTemplates)
    .values({
      id: `tpl${s}`,
      projectId,
      name: `chain${s}`,
      description: "",
      steps: "[]",
      createdAt: now,
    })
    .run();
  db.insert(schema.secrets)
    .values({ id: `sec${s}`, projectId, name: `SECRET${s}`, ciphertext: "x", createdAt: now })
    .run();
}

describe("crate-collect-store", () => {
  it("finds the project, and nothing for an unknown id", () => {
    assert.equal(projectRow("p1")?.slug, "one");
    assert.equal(projectRow("unknown"), undefined);
  });

  it("each table returns only the requested project's rows", () => {
    assert.deepEqual(
      agentRowsOf("p1").map((a) => a.name),
      ["dev"],
    );
    assert.deepEqual(
      environmentRowsOf("p1").map((e) => e.name),
      ["env"],
    );
    assert.deepEqual(
      repoRowsOf("p1").map((r) => r.name),
      ["repo"],
    );
    assert.deepEqual(
      ruleRowsOf("p1").map((r) => r.name),
      ["rule"],
    );
    assert.deepEqual(
      mcpServerRowsOf("p1").map((m) => m.name),
      ["mcp"],
    );
    assert.deepEqual(
      taskTemplateRowsOf("p1").map((t) => t.name),
      ["chain"],
    );
    assert.deepEqual(
      secretRowsOf("p1").map((s) => s.name),
      ["SECRET"],
    );
  });

  it("secrets come out still encrypted: decryption is the caller's rule", () => {
    assert.equal(secretRowsOf("p1")[0]!.ciphertext, "x");
  });

  it("an empty project returns empty lists, never undefined", () => {
    db.insert(schema.projects)
      .values({ id: "p3", name: "empty", slug: "three", createdAt: now })
      .run();
    assert.deepEqual(agentRowsOf("p3"), []);
    assert.deepEqual(secretRowsOf("p3"), []);
  });
});
