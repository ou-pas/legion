import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-project-create-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { insertProjectWithDefaults, projectById, slugExists } =
  await import("./project-create-store.js");
const { NETWORKING } = await import("../shared/enums.js");

const now = new Date();

describe("project-create-store", () => {
  it("slugExists is false before insertion", () => {
    assert.equal(slugExists("aurore"), false);
  });

  it("inserts the project, environment, repository and default agent in one block", () => {
    insertProjectWithDefaults({
      project: { id: "p1", name: "Aurore", slug: "aurore", createdAt: now },
      environment: {
        id: "e1",
        projectId: "p1",
        name: "open",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      },
      repo: {
        id: "r1",
        projectId: "p1",
        name: "main",
        url: "https://github.com/x/y.git",
        forge: "github",
        createdAt: now,
      },
      agent: {
        id: "a1",
        projectId: "p1",
        name: "default",
        title: "Default agent",
        rolePrompt: "r",
        fsGrants: "[]",
        createdAt: now,
      },
    });
    assert.equal(slugExists("aurore"), true);
    assert.equal(projectById("p1")?.name, "Aurore");
    assert.equal(db.select().from(schema.repos).all().length, 1);
    assert.equal(db.select().from(schema.agents).all().length, 1);
  });

  it("inserts no repository when `repo` is null", () => {
    insertProjectWithDefaults({
      project: { id: "p2", name: "No repo", slug: "no-repo", createdAt: now },
      environment: {
        id: "e2",
        projectId: "p2",
        name: "open",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      },
      repo: null,
      agent: {
        id: "a2",
        projectId: "p2",
        name: "default",
        title: "Default agent",
        rolePrompt: "r",
        fsGrants: "[]",
        createdAt: now,
      },
    });
    assert.equal(db.select().from(schema.repos).all().length, 1, "still the first project's one");
  });

  it("projectById returns undefined for an unknown id", () => {
    assert.equal(projectById("nope"), undefined);
  });
});
