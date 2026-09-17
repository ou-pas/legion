// A task's family, seen from its artifacts folders (batch 73).
//
// The real case that paid for this file: `tCgO0ORtqe`, filed by the session of `Sx-ZVdJP3r`, whose
// description says "full contract in /artifacts/Sx-ZVdJP3r/implementation.md". Its session did not
// have that folder, so it was sent to read a closed file.
//
// What this file locks, in order of importance: writing is never granted outside the session's
// folder (or the review trace becomes a many-handed document), the project boundary is hard, and
// the walk terminates (cycle, depth, cap).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-artscope-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { eq } = await import("drizzle-orm");
const { authorize } = await import("../../projects/fs-acl.js");
const { artifactsPath, linkedArtifactScopes, sessionArtifactGrants, LINKED_SCOPE_CAP } =
  await import("./scope.js");
const { addBlocker } = await import("../blockers.js");
const { SESSION_STATUS } = await import("../../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const P = "p-scope";
const OTHER = "p-other";
const now = new Date();

type TaskSeed = {
  id: string;
  projectId?: string;
  proposedFromTaskId?: string | null;
  /** A blocker, set in `task_blockers` (v44); it must already exist (FK). */
  blockedBy?: string;
  templateRunId?: string | null;
  goalId?: string | null;
};

function task(t: TaskSeed): void {
  db.insert(schema.tasks)
    .values({
      id: t.id,
      projectId: t.projectId ?? P,
      name: t.id,
      status: TASK_STATUS.todo,
      proposedFromTaskId: t.proposedFromTaskId ?? null,
      templateRunId: t.templateRunId ?? null,
      goalId: t.goalId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  if (t.blockedBy) addBlocker(t.id, t.blockedBy);
}

/** The row as the artifact scope reads it, re-read from the database so nothing imaginary is tested. */
function row(id: string) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
}

function reset(): void {
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.tasks).run();
  db.delete(schema.projects).run();
  for (const id of [P, OTHER])
    db.insert(schema.projects).values({ id, name: id, slug: id, createdAt: now }).run();
}

describe("the missing link: a task reads its origin's artifacts", () => {
  beforeEach(() => {
    reset();
    task({ id: "origin" });
    task({ id: "filed", proposedFromTaskId: "origin" });
  });

  it("the filed task sees the folder of the task that filed it", () => {
    assert.deepEqual(linkedArtifactScopes(row("filed")), ["origin"]);
  });

  it("and the origin sees the folder of what it filed: the link reads from both ends", () => {
    // The parent woken by `wait_for_task` needs its child's artifact: the same link walked the other
    // way, or half the use case stays blind.
    assert.deepEqual(linkedArtifactScopes(row("origin")), ["filed"]);
  });

  it("its own folder stays writable, the others read-only", () => {
    const grants = sessionArtifactGrants(row("filed"));
    const own = grants.find((g) => g.folderPath === "/artifacts/filed")!;
    const linked = grants.find((g) => g.folderPath === "/artifacts/origin")!;
    assert.equal(own.canWrite, true);
    assert.equal(linked.canRead, true);
    assert.equal(linked.canWrite, false);
    assert.equal(linked.canDelete, false);
  });

  it("end to end: reading the contract is allowed, overwriting it is not", () => {
    // The test describing what the agent observes: the same rule through `authorize`, the one the
    // /internal/…/fs route really calls.
    const grants = sessionArtifactGrants(row("filed"));
    assert.equal(authorize(grants, "read", "/artifacts/origin/implementation.md").ok, true);
    assert.equal(authorize(grants, "write", "/artifacts/origin/implementation.md").ok, false);
    assert.equal(authorize(grants, "write", "/artifacts/filed/pr.md").ok, true);
  });
});

describe("the family's other links", () => {
  beforeEach(reset);

  it("the prerequisite: the blocked task reads the folder of what blocks it", () => {
    task({ id: "prerequisite" });
    task({ id: "blocked", blockedBy: "prerequisite" });
    assert.deepEqual(linkedArtifactScopes(row("blocked")), ["prerequisite"]);
  });

  it("waiting: `wait_for_task` announces a folder, and it is now open", () => {
    // describeTaskOutcome tells the woken agent "Artifacts: /artifacts/<target>". Without this link,
    // that sentence described a closed folder.
    task({ id: "awaited" });
    task({ id: "sleeper" });
    db.insert(schema.agents)
      .values({ id: "a1", projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
      .run();
    db.insert(schema.runners).values({ id: "r1", name: "local", kind: RUNNER_KIND.process }).run();
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId: "sleeper",
        agentId: "a1",
        runnerId: "r1",
        status: SESSION_STATUS.waiting,
        model: "sonnet",
        callbackToken: "t",
        startedAt: now,
      })
      .run();
    db.insert(schema.inboxMessages)
      .values({
        id: "i1",
        sessionId: "s1",
        taskId: "sleeper",
        agentId: "a1",
        kind: "text",
        body: "waiting",
        waitForTaskId: "awaited",
        createdAt: now,
      })
      .run();
    assert.deepEqual(linkedArtifactScopes(row("sleeper")), ["awaited"]);
  });

  it("siblings meet in two steps, with no special case", () => {
    task({ id: "plan" });
    task({ id: "front", proposedFromTaskId: "plan" });
    task({ id: "back", proposedFromTaskId: "plan" });
    const scopes = linkedArtifactScopes(row("front"));
    assert.deepEqual(scopes.sort(), ["back", "plan"]);
  });

  it("and lineage walks up several generations", () => {
    task({ id: "g1" });
    task({ id: "g2", proposedFromTaskId: "g1" });
    task({ id: "g3", proposedFromTaskId: "g2" });
    assert.ok(linkedArtifactScopes(row("g3")).includes("g1"));
  });
});

describe("the bounds: this path runs on every fs call", () => {
  beforeEach(reset);

  it("the project boundary is hard: a link crossing it grants nothing", () => {
    // The link should not exist (propose_task creates in the session's project), but a hand-repaired
    // database or a future import could create it. An artifacts folder holds specs, diffs and
    // sometimes code excerpts: the boundary is checked here, not in the caller's intent.
    task({ id: "elsewhere", projectId: OTHER });
    task({ id: "here", proposedFromTaskId: "elsewhere" });
    assert.deepEqual(linkedArtifactScopes(row("here")), []);
  });

  it("a cycle does not make the walk go round in circles", () => {
    task({ id: "a" });
    task({ id: "b", proposedFromTaskId: "a" });
    addBlocker("a", "b");
    assert.deepEqual(linkedArtifactScopes(row("a")), ["b"]);
    assert.deepEqual(linkedArtifactScopes(row("b")), ["a"]);
  });

  it("a chain counts as one folder: its steps share their run scope", () => {
    task({ id: "origin" });
    for (const step of ["e1", "e2", "e3"])
      task({ id: step, templateRunId: "run-7", proposedFromTaskId: "origin" });
    assert.deepEqual(linkedArtifactScopes(row("origin")), ["run-7"]);
    // And the reverse: a step does not see "the other steps", it is already in their folder.
    assert.deepEqual(linkedArtifactScopes(row("e1")), ["origin"]);
    assert.equal(artifactsPath(row("e1")), "/artifacts/run-7");
  });

  it("a wide descent is capped, not unrolled", () => {
    task({ id: "stem" });
    for (let i = 0; i < LINKED_SCOPE_CAP + 8; i++)
      task({ id: `child-${i}`, proposedFromTaskId: "stem" });
    assert.equal(linkedArtifactScopes(row("stem")).length, LINKED_SCOPE_CAP);
  });

  it("a standalone task grants nothing beyond its own folder", () => {
    task({ id: "alone" });
    assert.deepEqual(linkedArtifactScopes(row("alone")), []);
    assert.deepEqual(
      sessionArtifactGrants(row("alone")).map((g) => g.folderPath),
      ["/artifacts/alone"],
    );
  });
});
