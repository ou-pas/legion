// Per-project override of chain agents (v29, 23/08):
//
//  1. The project mapping wins: a step whose role is mapped goes to the mapped agent, not the
//     catalogue's. Without a mapping, fall back to the catalogue name ('{}' everywhere at migration).
//  2. The error is named, at launch: a role mapped to a vanished agent refuses the whole chain (no
//     task created), never discovered mid-run.
//  3. A running chain is not re-resolved: tasks carry their frozen agentId.
//  4. Validation holds the boundary: an agentId from another project (or unknown) is refused with
//     the role spelled out; null clears everything; the object replaces the object.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-bindings-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { instantiateTemplate, resolveStepAgent, validateChainBindingsInput } =
  await import("./templates.js");

/** A chain, unwrapped. `instantiateTemplate` returns its refusal since 06/09 instead of throwing:
 *  an unexpected refusal must fail the test by naming it. */
const chainOf = (templateId: string, request: string) => {
  const r = instantiateTemplate(templateId, request);
  assert.ok(r.ok, r.ok ? "" : `unexpected refusal: ${r.error}`);
  return r.value;
};

const PROJECT = "p1";
const SPEC = { id: "a-spec", name: "spec" };
const DEV = { id: "a-dev", name: "senior-dev" };
const REVIEWER = { id: "a-rev", name: "reviewer" };
const AGENTS = [SPEC, DEV, REVIEWER];

function reset(bindings: Record<string, string> = {}) {
  const now = new Date();
  db.delete(schema.tasks).run();
  db.delete(schema.taskTemplates).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({
      id: PROJECT,
      name: "P",
      slug: "p",
      chainBindings: JSON.stringify(bindings),
      createdAt: now,
    })
    .run();
  for (const a of AGENTS)
    db.insert(schema.agents)
      .values({ id: a.id, projectId: PROJECT, name: a.name, rolePrompt: "r", createdAt: now })
      .run();
}

function makeTemplate(steps: object[]): string {
  const id = `tpl-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.taskTemplates)
    .values({
      id,
      projectId: PROJECT,
      name: "chain",
      steps: JSON.stringify(steps),
      autoRunNext: false,
      createdAt: new Date(),
    })
    .run();
  return id;
}

const STEP = (agentName: string, extra: object = {}) => ({
  name: "step",
  agentName,
  approvalGate: false,
  expectedArtifacts: [],
  prompt: "p",
  ...extra,
});

const tasksOf = (runId: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.templateRunId, runId)).all();

describe("resolveStepAgent: the mapping → catalogue cascade", () => {
  it("no mapping: falls back to the catalogue name", () => {
    const r = resolveStepAgent(STEP("senior-dev"), AGENTS, {});
    assert.deepEqual(r, { ok: true, agentId: DEV.id });
  });

  it("the role mapping wins over the name", () => {
    const r = resolveStepAgent(STEP("senior-dev"), AGENTS, { "senior-dev": REVIEWER.id });
    assert.deepEqual(r, { ok: true, agentId: REVIEWER.id });
  });

  it("an explicit role (step.role) is the key, not the agent name", () => {
    const r = resolveStepAgent(STEP("senior-dev", { role: "dev" }), AGENTS, { dev: SPEC.id });
    assert.deepEqual(r, { ok: true, agentId: SPEC.id });
  });

  it("mapped to a vanished agent: a named error (the role is in it)", () => {
    const r = resolveStepAgent(STEP("senior-dev"), AGENTS, { "senior-dev": "a-ghost" });
    assert.ok(!r.ok && r.error.includes("senior-dev"));
  });
});

describe("instantiateTemplate: resolved at launch, all or nothing", () => {
  beforeEach(() => reset());

  it("each step follows the cascade: mapped → mapped agent, unmapped → catalogue", () => {
    reset({ spec: REVIEWER.id });
    const tpl = makeTemplate([STEP("spec", { role: "spec" }), STEP("senior-dev")]);
    const { runId } = chainOf(tpl, "request");
    const rows = tasksOf(runId).sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
    assert.equal(rows[0]?.assigneeAgentId, REVIEWER.id, "mapped step");
    assert.equal(rows[1]?.assigneeAgentId, DEV.id, "step falling back to the catalogue");
  });

  it("a role mapped to a vanished agent refuses the whole chain, no task created", () => {
    reset({ "senior-dev": "a-ghost" });
    const tpl = makeTemplate([STEP("spec"), STEP("senior-dev")]);
    const refusal = instantiateTemplate(tpl, "request");
    assert.ok(!refusal.ok && refusal.status === 400 && refusal.error.includes("senior-dev"));
    assert.equal(db.select().from(schema.tasks).all().length, 0, "all or nothing");
  });

  it("a running chain is not re-resolved when the mapping changes afterwards", () => {
    const tpl = makeTemplate([STEP("senior-dev")]);
    const { runId } = chainOf(tpl, "request");
    db.update(schema.projects)
      .set({ chainBindings: JSON.stringify({ "senior-dev": SPEC.id }) })
      .where(eq(schema.projects.id, PROJECT))
      .run();
    assert.equal(tasksOf(runId)[0]?.assigneeAgentId, DEV.id, "the created agentId stays frozen");
  });

  it("an unreadable mapping (broken JSON) falls back to the catalogue, never throws", () => {
    db.update(schema.projects)
      .set({ chainBindings: "{oops" })
      .where(eq(schema.projects.id, PROJECT))
      .run();
    const tpl = makeTemplate([STEP("senior-dev")]);
    const { runId } = chainOf(tpl, "request");
    assert.equal(tasksOf(runId)[0]?.assigneeAgentId, DEV.id);
  });
});

describe("validateChainBindingsInput: the PATCH boundary", () => {
  it("null clears everything; a valid object passes trimmed", () => {
    assert.deepEqual(validateChainBindingsInput(null, AGENTS), { ok: true, value: {} });
    assert.deepEqual(validateChainBindingsInput({ " dev ": DEV.id }, AGENTS), {
      ok: true,
      value: { dev: DEV.id },
    });
  });

  it("agent unknown to the project: a refusal naming the role", () => {
    const r = validateChainBindingsInput({ dev: "a-other-project" }, AGENTS);
    assert.ok(!r.ok && r.error.includes("dev"));
  });

  it("not an object, empty value: refused", () => {
    assert.ok(!validateChainBindingsInput([], AGENTS).ok);
    assert.ok(!validateChainBindingsInput({ dev: "" }, AGENTS).ok);
  });

  it("null value = key ignored (catalogue fallback), not an error", () => {
    assert.deepEqual(validateChainBindingsInput({ dev: null }, AGENTS), { ok: true, value: {} });
  });
});
