// `infra-store.ts` only reads; the join itself (sessionJoin) is tested in infra.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-infra-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { sessionsByIds, sessionsInStates, tasksByIds } = await import("./infra-store.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p-infra-store";
const A = "a-infra-store";
const R = "r-infra-store";
const T1 = "t-infra-store-1";
const T2 = "t-infra-store-2";
const now = new Date();

before(() => {
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: R, name: "local", kind: RUNNER_KIND.docker }).run();
  for (const id of [T1, T2])
    db.insert(schema.tasks)
      .values({
        id,
        projectId: P,
        name: id,
        status: TASK_STATUS.doing,
        createdAt: now,
        updatedAt: now,
      })
      .run();
});

beforeEach(() => {
  db.delete(schema.sessions).run();
});

function session(id: string, taskId: string, status: string): void {
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: A,
      runnerId: R,
      status: status as "running",
      model: "sonnet",
      callbackToken: `tok-${id}`,
      startedAt: now,
    })
    .run();
}

describe("infra-store", () => {
  it("sessionsByIds returns an empty array without ids, otherwise the requested rows", () => {
    assert.deepEqual(sessionsByIds([]), []);
    session("s1", T1, SESSION_STATUS.running);
    assert.deepEqual(
      sessionsByIds(["s1", "absent"]).map((s) => s.id),
      ["s1"],
    );
  });

  it("sessionsInStates returns only the requested statuses", () => {
    session("s2", T1, SESSION_STATUS.running);
    session("s3", T1, SESSION_STATUS.waiting);
    assert.deepEqual(
      sessionsInStates([SESSION_STATUS.running]).map((s) => s.id),
      ["s2"],
    );
    assert.deepEqual(
      sessionsInStates([]).map((s) => s.id),
      [],
    );
  });

  it("tasksByIds returns an empty array without ids, otherwise the requested rows", () => {
    assert.deepEqual(tasksByIds([]), []);
    assert.deepEqual(
      tasksByIds([T2, "absent"]).map((t) => t.id),
      [T2],
    );
  });
});
