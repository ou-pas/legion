// Approving a batch ("decoupe" spec, behaviours 4, 5, 6 and the link half of 10):
//
//  1. A valid batch becomes tasks: N slices in todo, blocked by the declared ranks, assigned to
//     the `build` role's agent, carrying command, criteria and gate; Wiki blocked by each and not
//     released when Breakdown becomes done.
//  2. The gesture is unique: a second approval refuses (the step is done), an approval outside
//     review refuses and says so, and finishing Breakdown by another path (operator PATCH, Kanban
//     drop, the agent's `/internal`) is refused.
//  3. A faulty batch creates nothing and every fault is named: slice faults by rank, then batch
//     faults (zero slices, cycles named once by the ascending list of ranks). A missing or
//     unreadable artifact is named alone.
//  4. The refusal outlives the session: the step stays in review, the refusal is in the activity
//     feed, and a rerun's brief contains it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { TaskStatus } from "../tasks/lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-lot-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { approveLot, lotApprovalOnly, readLot, validateLot } = await import("./slices.js");
const { lastLotRefusal } = await import("./lot-refusal.js");
const { blockersOf, dependentsOf } = await import("../tasks/blockers.js");
const { applyTaskMove } = await import("../tasks/task-move.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

const PROJECT = "p1";
const TPL = "tpl-feature";
const DECOUPE = "t-decoupe";
const WIKI = "t-wiki";
const BUILD_AGENT = "a-build";
const fsRoot = join(dir, "repo");

/** The chain reduced to what the batch involves: Breakdown (marked `approvesLot`) then Wiki. */
const STEPS = [
  {
    name: "Breakdown",
    agentName: "slicer",
    approvalGate: true,
    approvesLot: true,
    expectedArtifacts: ["slices.json"],
    prompt: "cut",
  },
  {
    name: "Wiki",
    agentName: "librarian",
    approvalGate: false,
    expectedArtifacts: [],
    prompt: "doc",
  },
];

type SliceJson = Record<string, unknown>;

const criterion = (text = "a criterion", mode = "test") => ({ text, mode });
const slice = (over: SliceJson = {}): SliceJson => ({
  label: "A slice",
  successMeans: "An observable result",
  validatedBy: "pnpm -s test",
  criteria: [criterion()],
  blockedBy: [],
  ...over,
});

/** Writes `slices.json` into the run's artifacts folder. The batch read is the one present at
 *  approval time; a drop replaces the previous one (behaviour 4). */
function deposit(body: unknown): void {
  const artifacts = join(fsRoot, "artifacts", "run-1");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    join(artifacts, "slices.json"),
    typeof body === "string" ? body : JSON.stringify(body),
  );
}

function reset(opts: { bindings?: Record<string, string>; wikiStatus?: TaskStatus } = {}): void {
  const now = new Date();
  db.delete(schema.taskBlockers).run();
  db.delete(schema.taskActivity).run();
  db.delete(schema.tasks).run();
  db.delete(schema.taskTemplates).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  rmSync(fsRoot, { recursive: true, force: true });
  db.insert(schema.projects)
    .values({
      id: PROJECT,
      name: "P",
      slug: "p",
      fsRoot,
      chainBindings: JSON.stringify(opts.bindings ?? { build: BUILD_AGENT }),
      createdAt: now,
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: BUILD_AGENT,
      projectId: PROJECT,
      name: "senior-dev",
      rolePrompt: "r",
      createdAt: now,
    })
    .run();
  db.insert(schema.taskTemplates)
    .values({
      id: TPL,
      projectId: PROJECT,
      name: "feature",
      steps: JSON.stringify(STEPS),
      autoRunNext: false,
      createdAt: now,
    })
    .run();
  const step = (id: string, i: number, status: TaskStatus) => ({
    id,
    projectId: PROJECT,
    name: STEPS[i]!.name,
    description: "d",
    status,
    boardOrder: 1000 + i,
    approvalGate: STEPS[i]!.approvalGate,
    templateId: TPL,
    templateRunId: "run-1",
    stepIndex: i,
    expectedArtifacts: JSON.stringify(STEPS[i]!.expectedArtifacts),
    createdAt: now,
    updatedAt: now,
  });
  db.insert(schema.tasks)
    .values(step(DECOUPE, 0, TASK_STATUS.review))
    .run();
  db.insert(schema.tasks)
    .values(step(WIKI, 1, opts.wikiStatus ?? TASK_STATUS.todo))
    .run();
  // The chain link, as `instantiateTemplate` sets it, unless Wiki is already done: its link would
  // have been consumed then.
  if ((opts.wikiStatus ?? TASK_STATUS.todo) !== TASK_STATUS.done)
    db.insert(schema.taskBlockers)
      .values({ taskId: WIKI, blockerId: DECOUPE, createdAt: now })
      .run();
}

const taskOf = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
const created = () =>
  db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.templateRunId, "run-1"))
    .all()
    .filter((t) => t.stepIndex === null)
    .sort((a, b) => a.boardOrder - b.boardOrder);

beforeEach(() => reset());

describe("approveLot: a valid batch becomes tasks, in one gesture and one transaction", () => {
  it("N todo tasks, blocked by the declared ranks, gated, with command and criteria", () => {
    // The second slice's `property` criterion cites its edge, or the batch would be faulty
    // (behaviour 6).
    deposit({
      slices: [
        slice({
          label: "Base",
          successMeans: "The table exists",
          validatedBy: "node --test a.test.ts",
        }),
        slice({
          label: "Screen",
          successMeans: "The board counts",
          blockedBy: [1],
          criteria: [
            criterion("the count is visible", "human"),
            { text: "order does not matter", mode: "property", edge: "B8/ordering" },
          ],
        }),
      ],
    });

    const r = approveLot(DECOUPE);
    assert.equal(r.ok, true);
    const slices = created();
    assert.equal(slices.length, 2);
    assert.deepEqual(
      slices.map((t) => [t.name, t.status, t.approvalGate, t.assigneeAgentId]),
      [
        ["Slice 1/2 — Base", TASK_STATUS.todo, true, BUILD_AGENT],
        ["Slice 2/2 — Screen", TASK_STATUS.todo, true, BUILD_AGENT],
      ],
    );
    assert.equal(slices[0]!.description, "The table exists");
    assert.deepEqual(JSON.parse(slices[0]!.criteria!), {
      validatedBy: "node --test a.test.ts",
      items: [{ text: "a criterion", mode: "test" }],
    });
    // The declared rank became a link, and nothing more: the first one blocks nobody else.
    assert.deepEqual(blockersOf(slices[1]!.id), [slices[0]!.id]);
    assert.deepEqual(blockersOf(slices[0]!.id), []);
  });

  it("Wiki is blocked by every slice and not released when Breakdown becomes done", () => {
    deposit({ slices: [slice({ label: "A" }), slice({ label: "B" })] });
    assert.equal(approveLot(DECOUPE).ok, true);
    assert.equal(taskOf(DECOUPE).status, TASK_STATUS.done);
    // The Breakdown → Wiki link was consumed by the done; the two slices replaced it.
    assert.deepEqual(
      blockersOf(WIKI).sort(),
      created()
        .map((t) => t.id)
        .sort(),
    );
    assert.deepEqual(dependentsOf(DECOUPE), []);
  });

  it("Wiki already done by the operator gets no link", () => {
    reset({ wikiStatus: TASK_STATUS.done });
    deposit({ slices: [slice({ label: "A" }), slice({ label: "B" })] });
    assert.equal(approveLot(DECOUPE).ok, true);
    assert.deepEqual(blockersOf(WIKI), []);
    assert.equal(taskOf(WIKI).status, TASK_STATUS.done);
  });

  it("a second approval is refused: the step is already done", () => {
    deposit({ slices: [slice()] });
    assert.equal(approveLot(DECOUPE).ok, true);
    const again = approveLot(DECOUPE);
    assert.equal(again.ok, false);
    assert.match((again as { error: string }).error, /already done/);
    assert.equal(created().length, 1); // nothing new
  });

  it("from a status other than review, refused with the message", () => {
    db.update(schema.tasks)
      .set({ status: TASK_STATUS.doing })
      .where(eq(schema.tasks.id, DECOUPE))
      .run();
    deposit({ slices: [slice()] });
    const r = approveLot(DECOUPE);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /is not in review/);
    assert.equal(created().length, 0);
  });

  it("with no agent for the build role, a refusal naming the role and nothing created", () => {
    reset({ bindings: {} }); // no project mapping, no catalogue agent named build
    deposit({ slices: [slice()] });
    const r = approveLot(DECOUPE);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /“build” role/);
    assert.equal(created().length, 0);
    assert.equal(taskOf(DECOUPE).status, TASK_STATUS.review);
  });
});

describe("the gesture is unique: finishing Breakdown by another path is refused", () => {
  it("the shared guard names the approval, and only speaks of steps that approve a batch", () => {
    assert.match(lotApprovalOnly(taskOf(DECOUPE))!, /approving the batch/);
    assert.equal(lotApprovalOnly(taskOf(WIKI)), null);
  });

  it("a Kanban drop into done is refused, and the task does not move", () => {
    const r = applyTaskMove(DECOUPE, { status: TASK_STATUS.done, index: 0 });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /approving the batch/);
    assert.equal(taskOf(DECOUPE).status, TASK_STATUS.review);
  });
});

describe("validateLot: every fault, slices by rank then batch", () => {
  it("slice faults are prefixed by their rank, in order", () => {
    assert.deepEqual(
      validateLot([
        {
          label: "  ",
          outcome: "ok",
          validatedBy: "cmd",
          items: [{ text: "t", mode: "test" }],
          blockedBy: [],
        },
        { label: "ok", outcome: "ok", validatedBy: "", items: [], blockedBy: [9] },
      ]),
      [
        "slice 1: empty label",
        "slice 2: empty validation command",
        "slice 2: no criterion",
        "slice 2: blocker 9: points at no rank of the batch (1 to 2)",
      ],
    );
  });

  it("zero slices is a batch fault", () => {
    assert.deepEqual(validateLot([]), ["no slice in the batch"]);
  });

  it("a cycle is named once by the ascending list of ranks, a self-blocking slice included", () => {
    const ok = (over: object) => ({
      label: "l",
      outcome: "o",
      validatedBy: "c",
      items: [{ text: "t", mode: "test" }],
      ...over,
    });
    // 1 → 2 → 3 → 1 (one group, named once), and 4 blocking itself.
    assert.deepEqual(
      validateLot([
        ok({ blockedBy: [3] }),
        ok({ blockedBy: [1] }),
        ok({ blockedBy: [2] }),
        ok({ blockedBy: [4] }),
      ]),
      ["blockers in a cycle: slices 1, 2, 3", "blockers in a cycle: slices 4"],
    );
  });

  it("an acyclic graph produces no batch fault", () => {
    const ok = (over: object) => ({
      label: "l",
      outcome: "o",
      validatedBy: "c",
      items: [{ text: "t", mode: "test" }],
      ...over,
    });
    assert.deepEqual(
      validateLot([ok({ blockedBy: [] }), ok({ blockedBy: [1] }), ok({ blockedBy: [1, 2] })]),
      [],
    );
  });
});

describe("readLot: a missing or unreadable artifact is a fault named alone", () => {
  it("missing", () => {
    const r = readLot(taskOf(DECOUPE));
    assert.equal(r.ok, false);
    assert.match((r as { fault: string }).fault, /missing/);
  });

  it("not valid JSON", () => {
    deposit("{ not json");
    assert.match((readLot(taskOf(DECOUPE)) as { fault: string }).fault, /not valid JSON/);
  });

  it("the expected shape is missing", () => {
    deposit({ chunks: [] });
    assert.match((readLot(taskOf(DECOUPE)) as { fault: string }).fault, /expected shape/);
  });

  it("the latest drop replaces the previous one", () => {
    deposit({ slices: [slice({ label: "old" })] });
    deposit({ slices: [slice({ label: "new" }), slice({ label: "new 2" })] });
    const r = readLot(taskOf(DECOUPE));
    assert.equal(r.ok, true);
    assert.deepEqual(
      (r as { slices: { label: unknown }[] }).slices.map((s) => s.label),
      ["new", "new 2"],
    );
  });
});

describe("after a refusal: the step stays in review and the refusal survives", () => {
  it("nothing is created, the step stays in review, the refusal is in the feed with its faults", () => {
    deposit({ slices: [slice({ validatedBy: "" }), slice({ blockedBy: [1, 1] })] });
    const r = approveLot(DECOUPE);
    assert.equal(r.ok, false);
    assert.deepEqual((r as { faults: string[] }).faults, [
      "slice 1: empty validation command",
      "slice 2: blocker 1: cited twice",
    ]);
    assert.equal(created().length, 0);
    assert.equal(taskOf(DECOUPE).status, TASK_STATUS.review);
    assert.deepEqual(blockersOf(WIKI), [DECOUPE]); // the chain link is intact
    const refusal = lastLotRefusal(DECOUPE)!;
    assert.match(refusal, /^lot_refused/);
    assert.match(refusal, /empty validation command/);
    assert.match(refusal, /cited twice/);
  });

  it("a missing artifact leaves the same refusal, named alone", () => {
    const r = approveLot(DECOUPE);
    assert.equal(r.ok, false);
    assert.deepEqual((r as { faults: string[] }).faults.length, 1);
    assert.match(lastLotRefusal(DECOUPE)!, /missing/);
  });

  it("the rerun finds the latest refusal", () => {
    deposit({ slices: [] });
    approveLot(DECOUPE);
    deposit({ slices: [slice({ label: "" })] });
    approveLot(DECOUPE);
    const refusal = lastLotRefusal(DECOUPE)!;
    assert.match(refusal, /empty label/);
    assert.doesNotMatch(refusal, /no slice in the batch/);
  });

  it("with no refusal, there is nothing to put in the brief", () => {
    assert.equal(lastLotRefusal(WIKI), null);
  });
});
