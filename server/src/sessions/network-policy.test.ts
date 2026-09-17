// The network default. Without an environment, no restriction: operator's decision of 25/08
// evening, after a close look.
//
// This default went back and forth that day, and this file keeps BOTH halves of the reasoning,
// because the second makes no sense without the first.
//
// Morning: `!agent.environmentId → { mode: "open" }` was judged indefensible: the product promised
// least privilege, the runtime did the opposite for six agents out of seven, and the Environments
// screen already said an agent without environment had NO network access. The default became the
// wall to make that sentence true.
//
// Evening: the wall does not protect "the agents", it protects the SECRETS they carry. The agent
// most walled in by the switch was the only one carrying none, while two open-network agents
// carried a write PAT. A wall aimed beside what it protects costs blocked work without buying
// safety.
//
// What these tests pin: the wall still EXISTS, but it is set, not inherited. The only restricting
// path is an explicitly assigned `limited` environment.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { sql } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-netpolicy-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_RUNNER = "process"; // no Docker is touched by this file
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { buildNetworkPolicy } = await import("./runner/manager.js");
const { NETWORKING } = await import("../shared/enums.js");

const P1 = "p1";

function agent(environmentId: string | null) {
  db.delete(schema.agents).run();
  db.insert(schema.agents)
    .values({
      id: "a1",
      projectId: P1,
      name: "senior-dev",
      rolePrompt: "r",
      environmentId,
      createdAt: new Date(),
    })
    .run();
  return db.select().from(schema.agents).get()!;
}

beforeEach(() => {
  db.delete(schema.agents).run();
  db.delete(schema.environments).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "P1", slug: "p1", createdAt: new Date() })
    .run();
});

describe("buildNetworkPolicy: the wall is set, not inherited", () => {
  it("no environment: no restriction", () => {
    assert.deepEqual(buildNetworkPolicy(agent(null)), { mode: "open" });
  });

  it('an "open" environment opens too: the same effect, stated explicitly', () => {
    db.insert(schema.environments)
      .values({
        id: "e-open",
        projectId: P1,
        name: "open",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      })
      .run();
    assert.deepEqual(buildNetworkPolicy(agent("e-open")), { mode: "open" });
  });

  it("a limited environment returns ITS hosts: the ONLY restricting path", () => {
    db.insert(schema.environments)
      .values({
        id: "e-ci",
        projectId: P1,
        name: "ci",
        networking: NETWORKING.limited,
        allowedHosts: JSON.stringify(["github.com", "registry.npmjs.org"]),
      })
      .run();
    assert.deepEqual(buildNetworkPolicy(agent("e-ci")), {
      mode: "limited",
      allowedHosts: ["github.com", "registry.npmjs.org"],
    });
  });

  it("a BROKEN reference falls back to the default, like no environment", () => {
    // The foreign key makes this case impossible through normal writes, which is good news and
    // exactly why the test must bypass it: a database repaired by hand, a partial restore, and a
    // branch never executed is a branch we know nothing about. One rule: without a RESOLVED, limited
    // environment, nothing restricts.
    db.run(sql`PRAGMA foreign_keys = OFF`);
    try {
      assert.deepEqual(buildNetworkPolicy(agent("e-deleted")), { mode: "open" });
    } finally {
      db.run(sql`PRAGMA foreign_keys = ON`);
    }
  });
});
