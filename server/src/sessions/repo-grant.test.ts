// The grant leaf (09/09): what granting writes on the agent record, and what the agent reads. The
// full scenario (request → approval → resume) is in request-repo.test.ts; here, the two properties
// this module promises alone: idempotence, and refusing a name outside the project.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-repo-grant-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { grantAnswerText, grantRepoToAgent } = await import("./repo-grant.js");

const PROJECT = "p1";
const AGENT = "a1";

function reset() {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.repos).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.projects).values({ id: "p2", name: "P2", slug: "p2", createdAt: now }).run();
  db.insert(schema.repos)
    .values({
      id: "r1",
      projectId: PROJECT,
      name: "front",
      url: "https://x/front.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.repos)
    .values({
      id: "r2",
      projectId: "p2",
      name: "elsewhere",
      url: "https://x/elsewhere.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "dev",
      rolePrompt: "r",
      repoNames: "[]",
      createdAt: now,
    })
    .run();
}
const repos = (): string[] =>
  JSON.parse(
    db.select().from(schema.agents).where(eq(schema.agents.id, AGENT)).get()!.repoNames,
  ) as string[];

describe("grantRepoToAgent", () => {
  beforeEach(() => reset());

  it("writes the repository on the record, once even if the answer is replayed", () => {
    assert.equal(grantRepoToAgent(AGENT, "front").ok, true);
    assert.equal(grantRepoToAgent(AGENT, "front").ok, true);
    assert.deepEqual(repos(), ["front"]);
  });

  it("a repository of ANOTHER project is never granted, even if it exists", () => {
    const res = grantRepoToAgent(AGENT, "elsewhere");
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.error : "", /unknown in the agent's project/);
    assert.deepEqual(repos(), []);
  });
});

describe("grantAnswerText: what the agent reads", () => {
  it("granted: where the repository is, and what to do with it", () => {
    const t = grantAnswerText("front", true, null);
    assert.match(t, /GRANTED/);
    assert.match(t, /repos\/front/);
  });

  it("refused: the human's reason if they wrote one, and the ban on cloning", () => {
    assert.match(grantAnswerText("front", false, "not now"), /REFUSED by the operator: not now/);
    assert.match(grantAnswerText("front", false, null), /Do not clone it yourself/);
  });
});
