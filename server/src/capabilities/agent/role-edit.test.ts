// Protects:
//
//  1. an empty or blank role is refused (400): the system prompt would lose its "## Role"
//     section (sessions/runner/brief.ts);
//  2. the length cap (20 000, same as a task brief);
//  3. a live session of the agent blocks the edit (409, named): its spec is already out;
//  4. otherwise the role comes back trimmed, ready to write.
//
// Writing happens in the caller since 05/09; routes.test.ts holds its atomicity.
// Real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { SessionStatus } from "../../sessions/session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-agent-role-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { validateAgentRoleEdit, ROLE_PROMPT_MAX } = await import("./role-edit.js");
const { SESSION_STATUS } = await import("../../sessions/session-terminal.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const P1 = "p1";
const PDEMO = "pdemo";
const A1 = "a1";
const A_DEMO = "a-demo";
const RUNNER = "r1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now, demo: false },
      { id: PDEMO, name: "Demo", slug: "demo", createdAt: now, demo: true },
    ])
    .run();
  db.insert(schema.agents)
    .values([
      { id: A1, projectId: P1, name: "a1", rolePrompt: "original role", createdAt: now },
      { id: A_DEMO, projectId: PDEMO, name: "a-demo", rolePrompt: "demo role", createdAt: now },
    ])
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

function makeLiveSession(agentId: string, status: SessionStatus = "running", projectId = P1) {
  const now = new Date();
  const taskId = `t-${agentId}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.tasks)
    .values({
      id: taskId,
      projectId,
      name: "t",
      assigneeAgentId: agentId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId,
      runnerId: RUNNER,
      model: "sonnet",
      status,
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

describe("validateAgentRoleEdit", () => {
  beforeEach(() => reset());

  it("unknown agent → 404", () => {
    const r = validateAgentRoleEdit("nope", "a role");
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 404);
  });

  it("empty or blank role → 400", () => {
    for (const bad of ["", "   ", "\n\n"]) {
      const r = validateAgentRoleEdit(A1, bad);
      assert.equal(r.ok, false);
      assert.ok(!r.ok && r.status === 400);
    }
  });

  it("role too long (> 20 000) → 400, naming the length and the maximum", () => {
    const tooLong = "x".repeat(ROLE_PROMPT_MAX + 1);
    const r = validateAgentRoleEdit(A1, tooLong);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && /20 000|20000/.test(r.error));
  });

  it("exactly at the cap (20 000) → accepted", () => {
    const exact = "x".repeat(ROLE_PROMPT_MAX);
    const r = validateAgentRoleEdit(A1, exact);
    assert.ok(r.ok);
    assert.equal(r.ok && r.rolePrompt.length, ROLE_PROMPT_MAX);
  });

  it("returns the trimmed role, ready to write", () => {
    const r = validateAgentRoleEdit(A1, "  new role  \n");
    assert.ok(r.ok);
    assert.equal(r.ok && r.rolePrompt, "new role");
  });

  for (const status of ["starting", "running", SESSION_STATUS.waiting, "committing"] as const) {
    it(`${status} session on this agent → 409, named`, () => {
      makeLiveSession(A1, status);
      const r = validateAgentRoleEdit(A1, "role rewritten during the session");
      assert.equal(r.ok, false);
      assert.ok(!r.ok && r.status === 409 && r.live?.[0]?.status === status);
    });
  }

  for (const status of ["destroyed", "failed"] as const) {
    it(`${status} (ended) session does not block the edit`, () => {
      makeLiveSession(A1, status);
      const r = validateAgentRoleEdit(A1, "role after the session");
      assert.ok(r.ok);
    });
  }

  it("a live session on another agent does not block this one", () => {
    const other = "a-other";
    db.insert(schema.agents)
      .values({ id: other, projectId: P1, name: "other", rolePrompt: "r", createdAt: new Date() })
      .run();
    makeLiveSession(other, "running");
    const r = validateAgentRoleEdit(A1, "rewritten role");
    assert.ok(r.ok);
  });

  it("demo project: seeded sessions are ignored (even 'running'), the edit is never blocked", () => {
    makeLiveSession(A_DEMO, "running", PDEMO);
    const r = validateAgentRoleEdit(A_DEMO, "rewritten demo role");
    assert.ok(r.ok);
  });
});
