// Database access of `promote-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-agent-promote-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { allAgentTemplates, getAgent, insertAgentTemplate, updateAgentTemplate } =
  await import("./promote-store.js");

describe("agent-promote-store", () => {
  it("returns the agent by id, and nothing when it does not exist", () => {
    const now = new Date();
    db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
    db.insert(schema.agents)
      .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "role", createdAt: now })
      .run();
    assert.equal(getAgent("a1")?.name, "a1");
    assert.equal(getAgent("nope"), undefined);
  });

  it("inserts, lists, then edits a template", () => {
    const now = new Date();
    insertAgentTemplate({
      id: "t1",
      name: "t1",
      title: "",
      model: null,
      rolePrompt: "r",
      allowedTools: null,
      repoAccess: "none",
      inboxAccess: true,
      createdAt: now,
    });
    assert.equal(allAgentTemplates().find((t) => t.id === "t1")?.name, "t1");

    updateAgentTemplate("t1", {
      name: "t1",
      title: "title",
      model: null,
      rolePrompt: "r2",
      allowedTools: null,
      repoAccess: "none",
      inboxAccess: true,
    });
    assert.equal(allAgentTemplates().find((t) => t.id === "t1")?.rolePrompt, "r2");
  });
});
