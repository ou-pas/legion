// What travels and what does not. A template is reused in any project; carrying the original
// agent's grants would install ids that point at nothing there, or at something else. Only the
// card travels. And the upsert by name: two same-named templates would be indistinguishable.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-agent-promote-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { promoteAgentToTemplate } = await import("./promote.js");

const P1 = "p1";
const A1 = "a1";

beforeEach(() => {
  const now = new Date();
  db.delete(schema.agentTemplates).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: A1,
      projectId: P1,
      name: "auditor",
      title: "Auditor",
      model: "sonnet",
      rolePrompt: "audits",
      repoAccess: "read",
      inboxAccess: false,
      createdAt: now,
      repoNames: JSON.stringify(["api"]),
      envSecretNames: JSON.stringify(["TOKEN"]),
    })
    .run();
});

const templates = () => db.select().from(schema.agentTemplates).all();

describe("promoteAgentToTemplate", () => {
  it("404 on an unknown agent", () => {
    assert.deepEqual(promoteAgentToTemplate("never"), {
      ok: false,
      status: 404,
      error: "agent not found",
    });
  });

  it("copies the card: name, title, model, role, tools, repository and inbox access", () => {
    const result = promoteAgentToTemplate(A1);
    assert.equal(result.ok, true);
    assert.equal(result.updated, false);
    const [template] = templates();
    assert.equal(template?.name, "auditor");
    assert.equal(template?.title, "Auditor");
    assert.equal(template?.model, "sonnet");
    assert.equal(template?.rolePrompt, "audits");
    assert.equal(template?.repoAccess, "read");
    assert.equal(template?.inboxAccess, false);
  });

  it("copies no grant: grants point at a project's rows, and a template has no project", () => {
    promoteAgentToTemplate(A1);
    const [template] = templates();
    assert.equal(Object.keys(template ?? {}).includes("repoNames"), false);
    assert.equal(Object.keys(template ?? {}).includes("envSecretNames"), false);
  });

  it("updates the template on re-promotion instead of creating a namesake", () => {
    const first = promoteAgentToTemplate(A1);
    assert.equal(first.ok, true);
    db.update(schema.agents).set({ rolePrompt: "audits better" }).run();
    const second = promoteAgentToTemplate(A1);
    assert.equal(second.ok, true);
    assert.equal(second.updated, true);
    assert.equal(second.id, first.id);
    assert.equal(templates().length, 1);
    assert.equal(templates()[0]?.rolePrompt, "audits better");
  });
});
