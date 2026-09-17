// The read of `role-edit-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-agent-role-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { getAgent } = await import("./role-edit-store.js");

describe("agent-role-edit-store", () => {
  it("returns the agent by id", () => {
    const now = new Date();
    db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
    db.insert(schema.agents)
      .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "role", createdAt: now })
      .run();
    assert.equal(getAgent("a1")?.name, "a1");
  });

  it("returns `undefined` when the agent does not exist", () => {
    assert.equal(getAgent("nope"), undefined);
  });
});
