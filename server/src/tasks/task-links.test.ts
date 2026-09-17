// Lineage, and above all what it lets you do:
//
//  1. Both directions. A task says where it comes from and what it spawned. One direction only would
//     leave the operator finding the child by chance, exactly the state being fixed: four pairs sat
//     in the database with no screen showing them.
//  2. The suggested agent is resolved. An agent-filed task is never assigned: moving it to `todo` as
//     is puts it in a queue where its launch will fail. Resolving the suggested name to an id makes
//     the action possible in one gesture, and doing it server-side keeps the client from guessing.
//  3. A stale suggestion does not lie. The agent named back then may have been deleted since: we
//     return the name (it documents intent) and a null id (the action is no longer possible). The
//     screen can then offer something else rather than a failing button.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-links-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { addBlocker } = await import("./blockers.js");
const { pendingChildren, taskLinks, unmetPrerequisite } = await import("./task-links.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const PROJECT = "p1";
const AGENT = "a1";

function reset() {
  const now = new Date();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "front",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
}

type Status = TaskStatus;

function task(
  id: string,
  over: {
    status?: Status;
    parent?: string;
    agentId?: string | null;
    suggested?: string | null;
    at?: number;
  } = {},
) {
  const now = new Date(over.at ?? Date.now());
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: over.status ?? TASK_STATUS.later,
      assigneeAgentId: over.agentId ?? null,
      proposedFromTaskId: over.parent ?? null,
      proposedAgentName: over.suggested ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
// The block is set after both tasks (v44: a table with foreign keys, no longer a free column), hence
// `addBlocker` at the end of setup in the tests needing it.

beforeEach(reset);

describe("taskLinks: both directions of lineage", () => {
  it("the child names its parent", () => {
    task("p", { status: TASK_STATUS.done });
    task("c", { parent: "p" });
    assert.equal(taskLinks("c").parent?.id, "p");
    assert.equal(taskLinks("c").parent?.status, TASK_STATUS.done);
  });

  it("the parent lists its children", () => {
    task("p", { status: TASK_STATUS.done });
    task("c1", { parent: "p", at: 1_000 });
    task("c2", { parent: "p", at: 2_000 });
    assert.deepEqual(
      taskLinks("p").children.map((c) => c.id),
      ["c2", "c1"],
      "newest first",
    );
  });

  it("a task without lineage returns two empties, not an error", () => {
    task("alone");
    assert.deepEqual(taskLinks("alone"), { parent: null, children: [] });
  });

  it("a missing task returns two empties: a 404 page already says the rest", () => {
    assert.deepEqual(taskLinks("ghost"), { parent: null, children: [] });
  });
});

describe("the suggested agent, resolved server-side", () => {
  it("a suggested name existing in the project returns its id", () => {
    task("p", { status: TASK_STATUS.done });
    task("c", { parent: "p", suggested: "front" });
    const child = taskLinks("p").children[0]!;
    assert.equal(child.suggestedAgentName, "front");
    assert.equal(child.suggestedAgentId, AGENT, "it makes assignment possible in one gesture");
    assert.equal(child.agentName, null, "a filed task is never assigned");
  });

  it("a suggested name that no longer exists returns the name without an id", () => {
    task("p", { status: TASK_STATUS.done });
    task("c", { parent: "p", suggested: "deleted-agent" });
    const child = taskLinks("p").children[0]!;
    assert.equal(child.suggestedAgentName, "deleted-agent");
    assert.equal(
      child.suggestedAgentId,
      null,
      "the screen must offer something else, not a failing button",
    );
  });

  it("an assigned task returns its own agent's name, not a suggestion's", () => {
    task("p", { status: TASK_STATUS.done });
    task("c", { parent: "p", agentId: AGENT, status: TASK_STATUS.todo });
    assert.equal(taskLinks("p").children[0]!.agentName, "front");
  });
});

describe("pendingChildren: what we recall when approving", () => {
  it("only keeps what still sleeps in later", () => {
    task("p", { status: TASK_STATUS.review });
    task("sleeping", { parent: "p", status: TASK_STATUS.later });
    task("started", { parent: "p", status: TASK_STATUS.todo });
    task("finished", { parent: "p", status: TASK_STATUS.done });
    assert.deepEqual(
      pendingChildren(taskLinks("p")).map((c) => c.id),
      ["sleeping"],
    );
  });

  it("returns an empty list when everything is already launched: nothing to recall", () => {
    task("p", { status: TASK_STATUS.review });
    task("c", { parent: "p", status: TASK_STATUS.done });
    assert.deepEqual(pendingChildren(taskLinks("p")), []);
  });
});

// The dependency (25/08): `propose_task({ blocking: true })` sets a blocker link on the origin task.
// What follows protects reading that fact from both ends: a lineage that did not say "this one waits
// for that one" would leave exactly the gap just fixed, where a screen went `done` talking to routes
// that did not exist.
describe("blocksParent: lineage that is a dependency", () => {
  it("the parent sees which of its children blocks it, and only that one", () => {
    task("p", { status: TASK_STATUS.review });
    task("prereq", { parent: "p", at: 2_000 });
    task("extra", { parent: "p", at: 1_000 });
    addBlocker("p", "prereq");
    const children = taskLinks("p").children;
    assert.deepEqual(
      children.map((c) => [c.id, c.blocksParent]),
      [
        ["prereq", true],
        ["extra", false],
      ],
    );
  });

  it("the child sees it is awaited: the same fact, read from the other end", () => {
    task("p", { status: TASK_STATUS.review });
    task("prereq", { parent: "p" });
    addBlocker("p", "prereq");
    assert.equal(taskLinks("prereq").parent?.blocksParent, true);
  });

  it("a parent blocked by a foreign task marks none of its children", () => {
    task("elsewhere");
    task("p", { status: TASK_STATUS.todo });
    task("c", { parent: "p" });
    addBlocker("p", "elsewhere");
    assert.equal(taskLinks("p").children[0]!.blocksParent, false, "blocked, but not by its child");
  });
});

describe("unmetPrerequisite: what we oppose to an approval", () => {
  it("returns the sleeping prerequisite", () => {
    task("p", { status: TASK_STATUS.review });
    task("prereq", { parent: "p", status: TASK_STATUS.later });
    addBlocker("p", "prereq");
    assert.equal(unmetPrerequisite(taskLinks("p"))?.id, "prereq");
  });

  it("returns nothing when the prerequisite is done: the approval becomes ordinary again", () => {
    task("p", { status: TASK_STATUS.review });
    task("prereq", { parent: "p", status: TASK_STATUS.done });
    addBlocker("p", "prereq"); // a link that survived done: the prerequisite still counts as done
    assert.equal(unmetPrerequisite(taskLinks("p")), null);
  });

  it("a non-blocking child never holds back an approval", () => {
    task("p", { status: TASK_STATUS.review });
    task("extra", { parent: "p", status: TASK_STATUS.later });
    assert.equal(unmetPrerequisite(taskLinks("p")), null, "extra is not before");
  });
});
