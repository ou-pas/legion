// What this file protects, in order of importance:
//
//  1. a built-in chain referencing an agent absent from the catalogue would be installable
//     nowhere, and the defect would only show at the operator's first click;
//  2. installing must never silently fall back to the default agent: a chain whose review step
//     runs on a generic agent looks like it works and reviews nothing. The refusal must name the
//     missing agents, or it cannot be repaired;
//  3. a built-in entry cannot be deleted: it lives in the code, and deleting it from the database
//     would make it come back at the next boot (the lesson of 20/08).
//
// Real temporary SQLite: what is checked lives in constraints, transactions and name resolution.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";

// `db.ts` reads LEGION_DB on import: set it before the first dynamic import.
const dir = mkdtempSync(join(tmpdir(), "legion-catalog-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  BUILTIN_AGENTS,
  BUILTIN_CHAINS,
  catalogInconsistencies,
  CatalogError,
  deleteLibraryEntry,
  installChain,
  isBuiltinId,
  listAgentLibrary,
  listChainLibrary,
  listProjectChains,
  promoteChain,
  resolveStepAgents,
  uninstallChain,
} = await import("./catalog.js");
// Here and not at the bottom: the `it`s declared above run while the file's trailing
// `await import`s are still pending, and reading it before initialisation was a `ReferenceError`
// on every `pnpm test` (09/09).
const { REPO_ACCESS } = await import("../shared/enums.js");
const { BUILTIN_SKILLS, PROBE_SKILL_NAME, SLICE_SKILL_NAME, SPECIFY_SKILL_NAME } =
  await import("../capabilities/builtin-skills.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

let n = 0;
function makeProject(): string {
  const id = `p${++n}`;
  db.insert(schema.projects).values({ id, name: id, slug: id, createdAt: new Date() }).run();
  return id;
}
const projectAgents = (projectId: string) =>
  db
    .select()
    .from(schema.agents)
    .all()
    .filter((a) => a.projectId === projectId);
const projectChains = (projectId: string) =>
  db
    .select()
    .from(schema.taskTemplates)
    .all()
    .filter((t) => t.projectId === projectId);

/** The expected refusal, with its status and message: a mute 409 is no better than a crash. */
function refusal(fn: () => unknown): InstanceType<typeof CatalogError> {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof CatalogError, `expected a CatalogError, got ${String(e)}`);
    return e;
  }
  assert.fail("expected a refusal, the function succeeded");
}

describe("built-in catalogue", () => {
  it("the 2 chains only reference catalogue agents", () => {
    assert.deepEqual(catalogInconsistencies(), []);
    assert.deepEqual(BUILTIN_CHAINS.map((c) => c.name).sort(), ["bugfix", "feature"]);
    assert.deepEqual(BUILTIN_AGENTS.map((a) => a.name).sort(), [
      "interviewer",
      "librarian",
      "plan",
      "prober",
      "review-coordinator",
      "senior-dev",
      "slicer",
      "spec",
    ]);
  });

  // Slice 05, criterion 1: the `feature` chain replaces compound-engineer, step by step. 08/09:
  // step 1 moved from `spec` (writes alone) to `interviewer` (asks). The rest is unchanged, the
  // Probe still reads the same `spec.md`.
  it("feature: Interview, Probe, Breakdown, Wiki, Human review; gates on Interview, Probe, Breakdown, Review", () => {
    assert.equal(
      BUILTIN_CHAINS.some((c) => c.name === "compound-engineer"),
      false,
      "no longer in the catalogue",
    );
    const chain = BUILTIN_CHAINS.find((c) => c.name === "feature")!;
    assert.deepEqual(
      chain.steps.map((s) => [
        s.name,
        s.agentName,
        s.approvalGate,
        s.expectedArtifacts,
        s.approvesLot ?? false,
      ]),
      [
        ["Interview", "interviewer", true, ["spec.md"], false],
        ["Probe", "prober", true, ["SPEC-EDGES.md"], false],
        ["Breakdown", "slicer", true, ["slices.json"], true],
        ["Wiki", "librarian", false, ["wiki-update.md"], false],
        ["Human review", "senior-dev", true, ["summary.md"], false],
      ],
    );
    assert.ok(chain.autoRunNext);
  });

  it("bugfix is unchanged, step by step", () => {
    const chain = BUILTIN_CHAINS.find((c) => c.name === "bugfix")!;
    assert.deepEqual(
      chain.steps.map((s) => [
        s.name,
        s.agentName,
        s.approvalGate,
        s.expectedArtifacts,
        s.approvesLot,
      ]),
      [
        ["Reproduction", "senior-dev", false, ["repro.md"], undefined],
        ["Root cause diagnosis", "senior-dev", false, ["diagnostic.md"], undefined],
        ["Failing test", "senior-dev", false, ["failing-test.md"], undefined],
        ["Minimal fix", "senior-dev", false, ["fix.md"], undefined],
        ["Review", "review-coordinator", true, ["review.md"], undefined],
      ],
    );
    assert.ok(chain.autoRunNext);
  });

  // Slice 05, criterion 2: the two new agents and `spec`'s skill, as the install writes them. As
  // with the interviewer, a lost skill or a repository access granted by mistake would raise
  // nothing; the Probe would just run cheating.
  it("prober has no repository but inbox and probe; slicer reads with slice; interviewer carries grilling", () => {
    const projectId = makeProject();
    const res = installChain("builtin:feature", projectId);
    assert.deepEqual(res.createdAgents.sort(), [
      "interviewer",
      "librarian",
      "prober",
      "senior-dev",
      "slicer",
    ]);
    const row = (name: string) => projectAgents(projectId).find((a) => a.name === name)!;

    const prober = row("prober");
    assert.equal(prober.repoAccess, "none", "the Probe never reads the repository");
    assert.equal(prober.inboxAccess, true, "an open edge is asked through the inbox");
    assert.deepEqual(JSON.parse(prober.skillNames) as string[], [PROBE_SKILL_NAME]);
    assert.equal(prober.model, "opus");

    const slicer = row("slicer");
    assert.equal(slicer.repoAccess, "read");
    assert.deepEqual(JSON.parse(slicer.skillNames) as string[], [SLICE_SKILL_NAME]);

    // `spec` is no longer installed by the chain (08/09) but stays in the catalogue with
    // `specify`: the step changed holder, not the catalogue. What installing the interviewer
    // writes is checked below, in its own describe.
    assert.equal(
      projectAgents(projectId).some((a) => a.name === "spec"),
      false,
    );
    assert.deepEqual(BUILTIN_AGENTS.find((a) => a.name === "spec")!.skillNames, [
      SPECIFY_SKILL_NAME,
    ]);

    const registry = new Set(BUILTIN_SKILLS.map((s) => s.name));
    for (const s of [PROBE_SKILL_NAME, SLICE_SKILL_NAME, SPECIFY_SKILL_NAME])
      assert.ok(registry.has(s), s);
    assert.deepEqual(catalogInconsistencies(), []);
  });

  it("bugfix writes the test before the fix, and each step has its artifact", () => {
    const chain = BUILTIN_CHAINS.find((c) => c.name === "bugfix")!;
    assert.deepEqual(
      chain.steps.map((s) => s.expectedArtifacts),
      [["repro.md"], ["diagnostic.md"], ["failing-test.md"], ["fix.md"], ["review.md"]],
    );
    const test = chain.steps.findIndex((s) => s.expectedArtifacts[0] === "failing-test.md");
    const fix = chain.steps.findIndex((s) => s.expectedArtifacts[0] === "fix.md");
    assert.ok(test < fix, "the failing test must precede the fix: that is the whole discipline");
    assert.match(chain.steps[test]!.prompt, /BEFORE any fix/, "the step must say not to fix");
    assert.match(
      chain.steps[test]!.prompt,
      /VERBATIM failing output/,
      "and demand proof of the failure",
    );
    assert.ok(chain.steps.at(-1)!.approvalGate, "the review is an approval gate");
    assert.ok(chain.autoRunNext);
  });

  it("every built-in id carries the builtin: prefix", () => {
    for (const e of [...BUILTIN_AGENTS, ...BUILTIN_CHAINS]) assert.ok(isBuiltinId(e.id), e.id);
  });
});

describe("resolveStepAgents", () => {
  const steps = (...names: string[]) =>
    names.map((agentName, i) => ({
      name: `step ${i}`,
      agentName,
      approvalGate: false,
      expectedArtifacts: [],
      prompt: "",
    }));

  it("does not recreate an agent already in the project", () => {
    const r = resolveStepAgents(steps("spec", "plan"), {
      projectAgentNames: ["spec"],
      library: [],
    });
    assert.deepEqual(
      r.toCreate.map((a) => a.name),
      ["plan"],
    );
    assert.deepEqual(r.missing, []);
  });

  it("plans one creation per name, even when three steps ask for it", () => {
    const r = resolveStepAgents(steps("plan", "plan", "plan"), {
      projectAgentNames: [],
      library: [],
    });
    assert.deepEqual(
      r.toCreate.map((a) => a.name),
      ["plan"],
    );
  });

  it("the operator's library wins over the built-in catalogue", () => {
    const mine = {
      name: "spec",
      title: "my spec",
      model: "sonnet",
      rolePrompt: "mine",
      allowedTools: null,
      repoAccess: REPO_ACCESS.none,
      inboxAccess: true,
      skillNames: [],
    };
    const r = resolveStepAgents(steps("spec"), { projectAgentNames: [], library: [mine] });
    assert.equal(r.toCreate[0]!.rolePrompt, "mine");
  });

  it("returns the unresolved ones by name, with no fallback to a default agent", () => {
    const r = resolveStepAgents(steps("spec", "qa-lead", "sre"), {
      projectAgentNames: [],
      library: [],
    });
    assert.deepEqual(r.missing, ["qa-lead", "sre"]);
    assert.deepEqual(
      r.toCreate.map((a) => a.name),
      ["spec"],
    );
  });
});

describe("installing a chain", () => {
  it("installs feature and creates its 5 agents in an empty project", () => {
    const projectId = makeProject();
    const res = installChain("builtin:feature", projectId);
    assert.deepEqual(res.createdAgents.sort(), [
      "interviewer",
      "librarian",
      "prober",
      "senior-dev",
      "slicer",
    ]);
    const chains = projectChains(projectId);
    assert.equal(chains.length, 1);
    assert.equal(chains[0]!.name, "feature");
    const steps = JSON.parse(chains[0]!.steps) as { approvesLot?: boolean }[];
    assert.equal(steps.length, 5);
    // The flag travels with the copy: batch approval (slice 06) reads it.
    assert.deepEqual(
      steps.map((s) => s.approvesLot ?? false),
      [false, false, true, false, false],
    );
    // Least privilege: each agent arrives with its own folder, and nothing else.
    const prober = projectAgents(projectId).find((a) => a.name === "prober")!;
    assert.deepEqual(JSON.parse(prober.fsGrants), [
      { folderPath: "/agents/prober", canRead: true, canWrite: true, canDelete: false },
    ]);
    assert.equal(prober.repoAccess, "none");
    // Every step resolves: this is what instantiateTemplate checks at launch.
    const names = new Set(projectAgents(projectId).map((a) => a.name));
    for (const s of BUILTIN_CHAINS.find((c) => c.name === "feature")!.steps)
      assert.ok(names.has(s.agentName), s.agentName);
  });

  // Slice 05, criterion 3: an installed copy is a snapshot. The catalogue is rewritten in place and
  // nothing re-reads a copy from it: the `task_templates` row an earlier install wrote is returned
  // as is, byte for byte in its steps.
  it("a compound-engineer copy installed before the change is still listed as is", () => {
    const projectId = makeProject();
    // What installChain wrote before the slice: the name of the time and its nine steps. The French
    // step names are deliberate: this is legacy data, kept verbatim.
    const legacySteps = [
      "Spec",
      "Plan",
      "Revue du plan",
      "Révision du plan",
      "Implémentation",
      "Code review",
      "Corrections",
      "Wiki",
      "Revue humaine",
    ].map((name, i) => ({
      name,
      agentName: "senior-dev",
      approvalGate: i === 0 || i === 8,
      expectedArtifacts: [`${i}.md`],
      prompt: `étape ${i}`,
    }));
    const legacy = {
      id: "legacy-ce",
      projectId,
      name: "compound-engineer",
      description: "Spec (gate) → Plan → … → Revue humaine (gate)",
      steps: JSON.stringify(legacySteps),
      autoRunNext: true,
      createdAt: new Date(),
    };
    db.insert(schema.taskTemplates).values(legacy).run();

    assert.deepEqual(listProjectChains(projectId), [
      {
        id: "legacy-ce",
        projectId,
        name: "compound-engineer",
        description: legacy.description,
        steps: legacySteps,
        autoRunNext: true,
      },
    ]);
    assert.equal(
      projectChains(projectId)[0]!.steps,
      legacy.steps,
      "the steps did not move by a byte",
    );
    // The catalogue no longer offers it, and `feature` installs alongside with no name clash.
    assert.equal(
      listChainLibrary().some((c) => c.builtin && c.name === "compound-engineer"),
      false,
    );
    assert.equal(refusal(() => installChain("builtin:compound-engineer", projectId)).status, 404);
    assert.ok(installChain("builtin:feature", projectId).id);
    assert.deepEqual(
      listProjectChains(projectId)
        .map((c) => c.name)
        .sort(),
      ["compound-engineer", "feature"],
    );
  });

  it("reuses the project's agent instead of creating a second one with the same name", () => {
    const projectId = makeProject();
    db.insert(schema.agents)
      .values({
        id: `a${++n}`,
        projectId,
        name: "senior-dev",
        title: "mine",
        rolePrompt: "mine",
        fsGrants: "[]",
        createdAt: new Date(),
      })
      .run();
    const res = installChain("builtin:bugfix", projectId);
    assert.ok(!res.createdAgents.includes("senior-dev"));
    assert.equal(projectAgents(projectId).filter((a) => a.name === "senior-dev").length, 1);
    assert.equal(projectAgents(projectId).find((a) => a.name === "senior-dev")!.rolePrompt, "mine");
  });

  it("installing the same chain twice refuses with 409", () => {
    const projectId = makeProject();
    installChain("builtin:bugfix", projectId);
    const err = refusal(() => installChain("builtin:bugfix", projectId));
    assert.equal(err.status, 409);
    assert.match(err.message, /already installed/);
    assert.equal(projectChains(projectId).length, 1, "no duplicate copy");
  });

  it("an unresolvable step agent makes the install refuse by name, installing nothing", () => {
    const projectId = makeProject();
    db.insert(schema.chainTemplates)
      .values({
        id: "chain-orphan",
        name: "orphan",
        description: "",
        steps: JSON.stringify([
          {
            name: "Step",
            agentName: "qa-lead",
            approvalGate: false,
            expectedArtifacts: [],
            prompt: "",
          },
        ]),
        autoRunNext: true,
        createdAt: new Date(),
      })
      .run();
    const err = refusal(() => installChain("chain-orphan", projectId));
    assert.equal(err.status, 409);
    assert.match(err.message, /qa-lead/, "the missing name must be in the message");
    assert.equal(projectChains(projectId).length, 0, "nothing is half installed");
    assert.equal(projectAgents(projectId).length, 0);
  });

  it("refuses an unknown chain (404) and an unknown project (404)", () => {
    assert.equal(refusal(() => installChain("builtin:not-a-chain", makeProject())).status, 404);
    assert.equal(refusal(() => installChain("builtin:bugfix", "ghost-project")).status, 404);
  });
});

describe("library", () => {
  it("returns the built-in + promoted union, each entry knowing what it is", () => {
    const projectId = makeProject();
    installChain("builtin:feature", projectId);
    const mine = projectChains(projectId)[0]!;
    db.update(schema.taskTemplates)
      .set({ name: "mine" })
      .where(eq(schema.taskTemplates.id, mine.id))
      .run();
    promoteChain(mine.id);

    const chains = listChainLibrary();
    assert.deepEqual(
      chains
        .filter((c) => c.builtin)
        .map((c) => c.name)
        .sort(),
      ["bugfix", "feature"],
    );
    const promoted = chains.find((c) => c.name === "mine")!;
    assert.equal(promoted.builtin, false);
    assert.equal(promoted.steps.length, 5, "steps travel decoded");
    assert.equal(listAgentLibrary().filter((a) => a.builtin).length, BUILTIN_AGENTS.length);
  });

  it("promoting again updates instead of creating a duplicate", () => {
    const projectId = makeProject();
    installChain("builtin:bugfix", projectId);
    const mine = projectChains(projectId)[0]!;
    db.update(schema.taskTemplates)
      .set({ name: "mine-2" })
      .where(eq(schema.taskTemplates.id, mine.id))
      .run();
    const first = promoteChain(mine.id);
    assert.equal(first.updated, false);
    db.update(schema.taskTemplates)
      .set({ description: "v2" })
      .where(eq(schema.taskTemplates.id, mine.id))
      .run();
    const second = promoteChain(mine.id);
    assert.equal(second.updated, true);
    assert.equal(second.id, first.id);
    assert.equal(listChainLibrary().filter((c) => c.name === "mine-2").length, 1);
    assert.equal(listChainLibrary().find((c) => c.name === "mine-2")!.description, "v2");
  });

  it("refuses to promote under a built-in chain's name: two entries with one name", () => {
    const projectId = makeProject();
    installChain("builtin:bugfix", projectId);
    const err = refusal(() => promoteChain(projectChains(projectId)[0]!.id));
    assert.equal(err.status, 409);
    assert.match(err.message, /built-in chain/);
  });

  it("a builtin: id cannot be deleted, and the refusal says why", () => {
    for (const kind of ["agent", "chain"] as const) {
      const err = refusal(() => deleteLibraryEntry(kind, "builtin:spec"));
      assert.equal(err.status, 409);
      assert.match(err.message, /lives in the code/);
    }
    assert.equal(refusal(() => uninstallChain("builtin:bugfix")).status, 409);
    assert.equal(listChainLibrary().filter((c) => c.builtin).length, 2, "nothing disappeared");
  });

  it("deletes a promoted entry, and a project install does not suffer", () => {
    const projectId = makeProject();
    installChain("builtin:bugfix", projectId);
    const mine = projectChains(projectId)[0]!;
    db.update(schema.taskTemplates)
      .set({ name: "throwaway" })
      .where(eq(schema.taskTemplates.id, mine.id))
      .run();
    const { id } = promoteChain(mine.id);
    deleteLibraryEntry("chain", id);
    assert.equal(
      listChainLibrary().some((c) => c.name === "throwaway"),
      false,
    );
    assert.equal(projectChains(projectId).length, 1, "the project's copy stays");
  });
});

describe("removing a chain from a project", () => {
  it("refuses while an unfinished task follows it: autoRunNext would stay broken", () => {
    const projectId = makeProject();
    const { id: chainId } = installChain("builtin:bugfix", projectId);
    const agentId = projectAgents(projectId)[0]!.id;
    const now = new Date();
    db.insert(schema.tasks)
      .values({
        id: `t${++n}`,
        projectId,
        name: "step in progress",
        status: TASK_STATUS.doing,
        assigneeAgentId: agentId,
        templateId: chainId,
        templateRunId: "run1",
        stepIndex: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const err = refusal(() => uninstallChain(chainId));
    assert.equal(err.status, 409);
    assert.match(
      err.message,
      /step in progress/,
      "the offending task is named, not silently counted",
    );
    assert.equal(projectChains(projectId).length, 1);
  });

  it("allows removal when every task is done", () => {
    const projectId = makeProject();
    const { id: chainId } = installChain("builtin:bugfix", projectId);
    const agentId = projectAgents(projectId)[0]!.id;
    const now = new Date();
    db.insert(schema.tasks)
      .values({
        id: `t${++n}`,
        projectId,
        name: "finished step",
        status: TASK_STATUS.done,
        assigneeAgentId: agentId,
        templateId: chainId,
        templateRunId: "run2",
        stepIndex: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    assert.equal(uninstallChain(chainId).name, "bugfix");
    assert.equal(projectChains(projectId).length, 0);
    // And it can be reinstalled afterwards: removal does not leave the project stuck.
    assert.ok(installChain("builtin:bugfix", projectId).id);
  });
});

// The interviewer (discussion mode, /artifacts/rtQLldYSm2/spec.md).
//
// This agent's three failures are silent. A lost skill, a vanished web tool, an unset environment:
// none of them throws. The agent starts, works, and returns a degraded interview nobody can read as
// such, settling alone what it should have asked. Hence assertions on what the install writes to
// the database, not on what the catalogue declares.
const { installAgent } = await import("./catalog.js");
const { DEFAULT_TOOLS } = await import("../capabilities/tool-grants.js");
const { GRILLING_SKILL_NAME } = await import("../capabilities/builtin-skills.js");
const { NETWORKING } = await import("../shared/enums.js");

describe("the interviewer: the failures to avoid are mute", () => {
  // 08/09, operator's decision: the interview is step 1 of `feature`. This assertion said the
  // opposite until then (protecting D6/D7, "discussion mode lives beside the chain"); the half that
  // still holds is the second one: `spec` stays in the catalogue, assignable alone.
  it("holds step 1 of feature, and spec stays in the catalogue without holding it", () => {
    const step1 = BUILTIN_CHAINS.find((c) => c.name === "feature")!.steps[0]!;
    assert.equal(step1.agentName, "interviewer");
    assert.equal(step1.approvalGate, true, "without a gate it would finish its task and file");
    assert.match(step1.prompt, /do NOT deposit/, "the step must forbid it to file");
    assert.ok(
      BUILTIN_AGENTS.some((a) => a.name === "spec"),
      "the spec agent still exists",
    );
    assert.equal(
      BUILTIN_CHAINS.flatMap((c) => c.steps).some((s) => s.agentName === "spec"),
      false,
      "and no built-in chain binds it any more",
    );
  });

  it("is born reading the repository, with WebSearch and WebFetch, and its skill", () => {
    const projectId = makeProject();
    installAgent("builtin:interviewer", projectId);
    const row = projectAgents(projectId).find((a) => a.name === "interviewer")!;

    assert.equal(row.repoAccess, "read", "it reads the repository before each round (D1)");
    const tools = JSON.parse(row.allowedTools!) as string[];
    // WebFetch with WebSearch: searching then reading the page is one gesture. WebSearch alone would
    // let it quote summaries it never opened, which its skill forbids.
    assert.ok(tools.includes("WebSearch") && tools.includes("WebFetch"), tools.join(","));
    // And it keeps the whole default: web tools are added, they replace nothing.
    for (const t of DEFAULT_TOOLS) assert.ok(tools.includes(t), `${t} lost`);
    assert.deepEqual(JSON.parse(row.skillNames) as string[], [GRILLING_SKILL_NAME]);
  });

  it("is born with an open environment written to the database, never with no environment", () => {
    // D19: the "no environment = no wall" default flipped twice in a month. A capability resting on
    // an unstable default gets lost silently.
    const projectId = makeProject();
    installAgent("builtin:interviewer", projectId);
    const row = projectAgents(projectId).find((a) => a.name === "interviewer")!;

    assert.ok(row.environmentId, "no environment set");
    const env = db
      .select()
      .from(schema.environments)
      .all()
      .find((e) => e.id === row.environmentId)!;
    assert.equal(env.networking, "open");
    assert.equal(
      env.projectId,
      projectId,
      "the environment is the project's own, not a shared one",
    );
  });

  it("reuses the project's open environment instead of stacking a second one", () => {
    const projectId = makeProject();
    db.insert(schema.environments)
      .values({
        id: `e${++n}`,
        projectId,
        name: "mine",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      })
      .run();
    installAgent("builtin:interviewer", projectId);
    const envs = db
      .select()
      .from(schema.environments)
      .all()
      .filter((e) => e.projectId === projectId);
    assert.equal(envs.length, 1, "a second open one would have been an invisible duplicate");
    assert.equal(envs[0]!.name, "mine");
  });

  it("the other built-in agents do not gain an environment on the way", () => {
    // The blast radius is bounded: D19 only concerns the agent whose capability would be lost.
    const projectId = makeProject();
    installAgent("builtin:librarian", projectId);
    const row = projectAgents(projectId).find((a) => a.name === "librarian")!;
    assert.equal(row.environmentId, null);
    assert.deepEqual(JSON.parse(row.skillNames) as string[], []);
  });
});
