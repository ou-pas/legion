// Opening an id from ⌘K (26/08). `idCandidate` is the half that matters: too lax and the palette
// queries on every letter; too strict and it refuses the pasted URL, which is the real gesture.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-lookup-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { idCandidate, lookupId } = await import("./lookup.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

const P = "pr0jectAAA",
  A = "ag3ntBBBBB",
  T = "t4skCCCCCC",
  G = "g0alDDDDDD";
const now = new Date();

before(() => {
  db.insert(schema.projects)
    .values({ id: P, name: "Legion", slug: "legion", createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "front", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({
      id: T,
      projectId: P,
      name: "11 · Triggers screen",
      status: TASK_STATUS.review,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.goals)
    .values({
      id: G,
      projectId: P,
      name: "Cut build time",
      request: "…",
      createdAt: now,
    })
    .run();
});

describe("recognising input that may be an id", () => {
  it("a bare id", () => {
    assert.equal(idCandidate("CuoCofyaaW"), "CuoCofyaaW");
    assert.equal(idCandidate("  CuoCofyaaW  "), "CuoCofyaaW");
  });

  it("A PASTED URL, because that is what the clipboard holds", () => {
    assert.equal(idCandidate("http://localhost:5173/tasks/CuoCofyaaW"), "CuoCofyaaW");
    assert.equal(idCandidate("http://localhost:5173/tasks/CuoCofyaaW?tab=diff"), "CuoCofyaaW");
    assert.equal(idCandidate("http://localhost:5173/tasks/CuoCofyaaW#trace"), "CuoCofyaaW");
    assert.equal(idCandidate("/tasks/CuoCofyaaW/"), "CuoCofyaaW");
  });

  it("a deep URL gives the LAST segment: the page being viewed", () => {
    assert.equal(
      idCandidate("http://localhost:5173/p/rN0_3r99mj/channels/fxHi2IpRXo"),
      "fxHi2IpRXo",
    );
  });

  it("product nanoids pass, dashes and underscores included", () => {
    for (const id of ["rN0_3r99mj", "bEtt0x-diy", "aY4Mjb00Ln"]) assert.equal(idCandidate(id), id);
  });

  it("what is NOT an id triggers no call", () => {
    // Each `null` is a server round trip saved while typing a command.
    for (const s of ["", "   ", "new task", "infra", "create a", "a", "abc"])
      assert.equal(idCandidate(s), null);
  });

  it("unreasonably long input is refused", () => {
    assert.equal(idCandidate("x".repeat(40)), null);
  });
});

describe("what an id designates", () => {
  it("a task, with its name to recognise it", () => {
    assert.deepEqual(lookupId(T), {
      kind: "task",
      id: T,
      label: "11 · Triggers screen",
      projectId: P,
    });
  });

  it("a goal", () => {
    assert.deepEqual(lookupId(G), {
      kind: "goal",
      id: G,
      label: "Cut build time",
      projectId: P,
    });
  });

  it("an agent", () => {
    assert.deepEqual(lookupId(A), { kind: "agent", id: A, label: "front", projectId: P });
  });

  it("a project, with no parent project of course", () => {
    assert.deepEqual(lookupId(P), { kind: "project", id: P, label: "Legion", projectId: null });
  });

  it("an unknown id returns nothing", () => {
    assert.equal(lookupId("doesnotexist1"), null);
  });
});
