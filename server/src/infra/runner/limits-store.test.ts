// `limits-store.ts` only counts, grouped by runner; `limits.ts` decides which statuses occupy one.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-runner-limits-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { sessionCountsByRunner } = await import("./limits-store.js");
const { SESSION_STATUS } = await import("../../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const P = "p-rlims";
const A = "a-rlims";
const T = "t-rlims";
const R = "r-rlims";
const R2 = "r-rlims-2";
const now = new Date();

before(() => {
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({
      id: T,
      projectId: P,
      name: "t",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  for (const id of [R, R2])
    db.insert(schema.runners).values({ id, name: id, kind: RUNNER_KIND.docker }).run();
});

beforeEach(() => {
  db.delete(schema.sessions).run();
});

function session(id: string, runnerId: string, status: string): void {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: T,
      agentId: A,
      runnerId,
      status: status as "running",
      model: "sonnet",
      callbackToken: `tok-${id}`,
      startedAt: now,
    })
    .run();
}

describe("runner-limits-store", () => {
  it("counts sessions in the requested statuses, grouped by runner", () => {
    session("s1", R, SESSION_STATUS.running);
    session("s2", R, SESSION_STATUS.running);
    session("s3", R, SESSION_STATUS.destroyed);
    session("s4", R2, SESSION_STATUS.running);
    assert.deepEqual(
      sessionCountsByRunner([SESSION_STATUS.running]),
      new Map([
        [R, 2],
        [R2, 1],
      ]),
    );
  });

  it("no requested status returns an empty map", () => {
    session("s5", R, SESSION_STATUS.running);
    assert.deepEqual(sessionCountsByRunner([]), new Map());
  });
});
