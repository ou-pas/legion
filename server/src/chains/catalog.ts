// Built-in catalog + global chain library.
//
// Why this file writes NOTHING to the database at boot: anything seeded comes back after it is
// deleted. That is exactly what killed the server on 20/08 (see the seeding comment in db.ts).
// The 5 agents and the 2 chains shipped with Legion therefore live IN THE CODE, carry an id
// prefixed with `builtin:`, and cannot be deleted: erasing them would make no sense since they
// are not operator data. "The 5 agents and the 2 chains" of 20/08 are 8 agents since slice 05
// (interviewer, prober, slicer).
//
// Three levels, from nearest to furthest:
//   · the PROJECT's agents/chains  (tables `agents` / `task_templates`)
//   · the OPERATOR's library       (tables `agent_templates` / `chain_templates`, v18)
//   · the built-in CATALOG         (this file)
// Routes render the union of the last two; installation resolves in that order.
import { nanoid } from "nanoid";
import {
  agentNamesOfProject,
  chainsOfProject,
  deletePromotedAgent,
  deletePromotedChain,
  deleteProjectChain,
  insertAgent,
  insertChainWithAgents,
  insertPromotedChain,
  projectChain,
  projectExists,
  promotedAgent,
  promotedAgents,
  promotedChain,
  promotedChains,
  tasksOfChain,
  updateChainSpec,
} from "./catalog-store.js";
import {
  BUILTIN_SKILLS,
  GRILLING_SKILL_NAME,
  PROBE_SKILL_NAME,
  SLICE_SKILL_NAME,
  SPECIFY_SKILL_NAME,
} from "../capabilities/builtin-skills.js";
import { DEFAULT_TOOLS, WEB_TOOLS } from "../capabilities/tool-grants.js";
import { ensureOpenEnvironment } from "../environments/environments.js";
import type { TemplateStep } from "./templates.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { NETWORKING } from "../shared/enums.js";
import { REPO_ACCESS } from "../shared/enums.js";

export const BUILTIN_PREFIX = "builtin:";

export type RepoAccess = "none" | "read" | "write";

/** An agent, reduced to what TRAVELS from one project to another. Grants (folders, env,
 *  secrets, MCP, repos) stay per project — same contract as agent promotion (v11). */
export type AgentSpec = {
  name: string;
  title: string;
  model: string | null;
  rolePrompt: string;
  allowedTools: string | null;
  repoAccess: RepoAccess;
  inboxAccess: boolean;
  /** The SKILLS the agent carries at install time (folder names under `data/skills/`).
   *
   *  This field was missing, and it is the only hole this batch fills (D8/D20): `allowedTools`
   *  was already declarable here, which makes the two fields symmetric without making them
   *  identical. An agent whose PROTOCOL lives in a skill rather than in its `rolePrompt` can be
   *  appropriated: whoever installs Legion improves the technique for their own context without
   *  patching a built-in agent or waiting for a release (operator's reason, D8).
   *
   *  Entries promoted by the operator (`agent_templates`) have no column for this and therefore
   *  arrive with `[]`: promoting an agent does not carry its skills along, exactly as it does
   *  today. That is a known limit, not an oversight. */
  skillNames: string[];
};

export type ChainSpec = {
  name: string;
  description: string;
  steps: TemplateStep[];
  autoRunNext: boolean;
};

/** A CATALOG agent. `networking` is not in `AgentSpec` and will not go there: it is not a
 *  property that travels from one project to another (grants stay per project), it is a
 *  REQUIREMENT declared by the catalog and honoured at install time — an open environment of
 *  the target project is resolved or created, then set on the agent (see `ensureOpenEnvironment`,
 *  D19). Absent = nothing is set, and the agent inherits the server default, like the first five. */
export type CatalogAgent = AgentSpec & { id: string; networking?: "open" };
export type CatalogChain = ChainSpec & { id: string };

/** An error carrying an HTTP status: routes relay it as is, the logic stays here. */
export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

// ---------------------------------------------------------------- built-in agents
// Prompts reconstructed from Danny Postma's Legion talk — not his verbatim files.
// Models are tier ALIASES (`opus`, `haiku`): a dated identifier goes stale silently and the API
// ends up refusing the agent (see models.ts and migration v17).
const agent = (a: AgentSpec & { networking?: "open" }): CatalogAgent => ({
  ...a,
  id: `${BUILTIN_PREFIX}${a.name}`,
});

export const BUILTIN_AGENTS: CatalogAgent[] = [
  agent({
    name: "spec",
    title: "Writes approvable specs",
    model: "opus",
    rolePrompt:
      "You are the spec agent. Turn the operator's request into a precise, reviewable specification, " +
      `in the shape the “${SPECIFY_SKILL_NAME}” skill gives: problem, numbered observable behaviours, ` +
      "seams, decisions, out of scope. Save it as the expected artifact. The human approves it — " +
      "write for their reading.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.none,
    inboxAccess: true,
    // The shape of the spec is a skill and not one more line here, for the same reason as
    // `grilling` (D8): it is the part a project adapts. A copy of `spec` already installed does
    // not receive it — that is the rule for every installed copy, without exception.
    skillNames: [SPECIFY_SKILL_NAME],
  }),
  agent({
    name: "plan",
    title: "Turns a spec into an ordered plan",
    model: "opus",
    rolePrompt:
      "You are the plan agent. Read the approved spec artifact and produce an ordered implementation " +
      "plan with atomic steps, risks, and test strategy. Save it as the expected artifact.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.none,
    inboxAccess: true,
    skillNames: [],
  }),
  agent({
    name: "senior-dev",
    title: "Implements and fixes",
    model: null,
    rolePrompt:
      "You are the senior-dev agent. Implement or fix according to the plan artifacts. Persist every " +
      "deliverable through the Legion fs tools. Verify your work before finishing.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.none,
    inboxAccess: true,
    skillNames: [],
  }),
  agent({
    name: "review-coordinator",
    title: "Coordinates reviews, consolidates must-fix/should-fix",
    model: null,
    rolePrompt:
      "You are the review coordinator. Review the referenced artifacts from three angles — feasibility, " +
      "scope creep, coherence — and produce ONE consolidated report with must-fix and should-fix items. " +
      "Save it as the expected artifact.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.none,
    inboxAccess: true,
    skillNames: [],
  }),
  agent({
    name: "librarian",
    title: "Keeps the documentation up to date",
    model: "haiku",
    rolePrompt:
      "You are the librarian. Read the artifacts of this template run and write the documentation/wiki " +
      "update. Save it as the expected artifact.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.none,
    inboxAccess: true,
    skillNames: [],
  }),
  // THE INTERVIEWER — discussion mode (/artifacts/rtQLldYSm2/spec.md).
  //
  // It does not replace `spec` and does not touch it: step 1 of the `feature` chain binds its
  // agent by the STRING "spec" (FEATURE_STEPS, below). Discussion mode lives next to the chain,
  // which does not change (D6/D7).
  //
  // Three settings set it apart from the other five, and each has its reason:
  //  · `repoAccess: REPO_ACCESS.read` — it reads the repository BEFORE each round and quotes what
  //    it read (D1). The first five are on "none"; this is implied by its job, not a separate
  //    decision.
  //  · `allowedTools` = the default PLUS the two web tools (D18). Without search it would settle
  //    facts absent from the repository on its own instead of turning them into questions — which
  //    betrays the "facts are looked up" half of its skill. `WebFetch` together with `WebSearch`
  //    because searching then READING the page is a single gesture: `WebSearch` alone would let it
  //    quote summaries it never opened, exactly what its skill forbids.
  //  · `networking: NETWORKING.open` EXPLICITLY (D19) — see `ensureOpenEnvironment`.
  //
  // And its protocol is not here: it is in the `grilling` skill (D8/D17). This prompt states the
  // post only; the technique can be appropriated on disk.
  agent({
    name: "interviewer",
    title: "Puts a brief to the test before it goes out",
    model: "opus",
    rolePrompt:
      "You are the interviewer. Before any work starts, you turn a thin request into a specification " +
      "the human has actually decided — by INTERVIEWING them, one inbox round at a time. Follow the " +
      `“${GRILLING_SKILL_NAME}” skill: it holds the protocol, and it is the part meant to be adapted ` +
      "to this project. Read the repository and search the web BEFORE each round: facts are looked up, " +
      "trade-offs are asked. There is no cap on rounds — stop when a round would no longer change the " +
      "work. Finish with spec.md in the run artifacts AND a proposed task whose brief IS the spec.",
    allowedTools: JSON.stringify([...DEFAULT_TOOLS, ...WEB_TOOLS]),
    repoAccess: REPO_ACCESS.read,
    inboxAccess: true,
    skillNames: [GRILLING_SKILL_NAME],
    networking: NETWORKING.open,
  }),
  // THE PROBE AND THE BREAKDOWN — the `feature` chain.
  //
  // `prober` has NO access to the repository, and that is the heart of its post: settling an edge
  // from what the code does today is taking the code for the spec — the very mistake the Probe
  // exists to catch. It has the inbox because an open edge can only be settled by asking the
  // operator, a whole round's front in one question. Its protocol is in `probe`.
  agent({
    name: "prober",
    title: "Probes a spec and counts what it leaves unsaid",
    model: "opus",
    rolePrompt:
      "You are the prober. Your only input is spec.md in the run artifacts — you never read the " +
      `repository, on purpose. Follow the “${PROBE_SKILL_NAME}” skill: it holds the protocol. Write ` +
      "SPEC-EDGES.md beside the spec. Every open edge of a round goes into ONE inbox question, one " +
      "field per edge; write each answer in SPEC-EDGES.md and in the spec's decisions. When no " +
      "applicable edge is left unresolved, leave the task for review — the operator closes it.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.none,
    inboxAccess: true,
    skillNames: [PROBE_SKILL_NAME],
  }),
  // `slicer` reads the repository (naming the module each behaviour will touch is its step 2)
  // and has no inbox: the question it would ask a human, "is the granularity right?", IS its
  // step's gate — the operator answers it by approving the batch, or by refusing it with its
  // faults in the brief of the rerun. Its protocol is in `slice`.
  agent({
    name: "slicer",
    title: "Cuts a probed spec into slices",
    model: null,
    rolePrompt:
      "You are the slicer. Read spec.md and SPEC-EDGES.md from the run artifacts, read the code each " +
      `behaviour will touch, and cut the work into slices following the “${SLICE_SKILL_NAME}” skill. ` +
      "Save slices.json in the run artifacts, in the exact shape the skill gives, then leave the " +
      "task for review — the operator approves the lot from there.",
    allowedTools: null,
    repoAccess: REPO_ACCESS.read,
    inboxAccess: false,
    skillNames: [SLICE_SKILL_NAME],
  }),
];

// ---------------------------------------------------------------- built-in chains
const chain = (c: ChainSpec): CatalogChain => ({ ...c, id: `${BUILTIN_PREFIX}${c.name}` });

// THE `feature` CHAIN (slice 05) — it REPLACES compound-engineer in the catalog, in place,
// because the catalog is the source and an installed chain is a snapshot that does not move: a
// copy of compound-engineer inside a project stays as it is and keeps running. Renamed because it
// pairs with `bugfix` on the board without explanation, and because a name that says what it is
// for ages better than a name that describes its mechanism.
//
// Nine fixed steps re-read the same context nine times. Five are left, and what matters is in
// their GATES: Interview, Probe and Breakdown put themselves up for review and only the operator
// finishes them. Slices are not steps of the chain: they are born from `slices.json` when the
// batch is approved, between Breakdown and Wiki (`approvesLot`, slice 06), in a number the
// Breakdown decides. Human review stays blocked by Wiki, as before.
const FEATURE_STEPS: TemplateStep[] = [
  // STEP 1 IS AN INTERVIEW, NO LONGER A WRITE-UP (08/09, operator's decision). It used to be held
  // by `spec` + `specify`: an agent writing a spec ALONE from a thin request, settling by itself
  // what it does not know. The `interviewer` does the opposite — it asks, round after round, and
  // writes the decisions down with the human's reason. Since discussion mode the two coexisted
  // producing the same artifact: the chain took the worse one. `spec` stays in the catalog,
  // installable on its own; it is the step that changes holder.
  //
  // The interview OUTSIDE a chain ("Discuss" button) does not change: a standalone task, with no
  // template, so a project with no chain installed keeps discussion mode whole. That is what is
  // left of D6/D7, and that is why the button is not rerouted through the chain.
  {
    name: "Interview",
    agentName: "interviewer",
    approvalGate: true,
    expectedArtifacts: ["spec.md"],
    prompt:
      "Interview the human about the request below, following the “grilling” skill, and save the " +
      "result as spec.md in the run artifacts folder. This task carries a gate: do NOT terminate " +
      "it and do NOT deposit a task for the work — leave it for review. The operator approves the " +
      "spec, and the next step of this chain sounds it for what it leaves open.",
  },
  {
    name: "Probe",
    agentName: "prober",
    approvalGate: true,
    expectedArtifacts: ["SPEC-EDGES.md"],
    prompt:
      "Read spec.md from the run artifacts and sound it following the “probe” skill. Write SPEC-EDGES.md " +
      "beside it. Ask every open edge of a round in ONE inbox question, one field per edge, and write " +
      "each answer both in SPEC-EDGES.md and in the spec's decisions. When no applicable edge is left " +
      "unresolved, leave the task for review.",
  },
  {
    name: "Breakdown",
    agentName: "slicer",
    approvalGate: true,
    approvesLot: true,
    expectedArtifacts: ["slices.json"],
    prompt:
      "Read spec.md and SPEC-EDGES.md from the run artifacts and cut the work into slices following the " +
      "“slice” skill. Save slices.json in the run artifacts, then leave the task for review: the " +
      "operator approves the lot from there, and that approval is what creates the slice tasks.",
  },
  {
    name: "Wiki",
    agentName: "librarian",
    approvalGate: false,
    expectedArtifacts: ["wiki-update.md"],
    prompt: "Write wiki-update.md documenting what this run produced.",
  },
  {
    name: "Human review",
    agentName: "senior-dev",
    approvalGate: true,
    expectedArtifacts: ["summary.md"],
    prompt:
      "Write summary.md: a short human-facing recap of the whole run with links to every artifact, " +
      "then leave the task for human review.",
  },
];

// The discipline of this chain holds in one rule, and it is in the ORDER of the steps, not in a
// prompt that asks politely: the regression test is written BEFORE the fix, and the step must
// PROVE that it fails (the run output is expected in failing-test.md). A test written after the
// fix proves nothing: it passes, without anyone knowing whether it would have failed.
const BUGFIX_STEPS: TemplateStep[] = [
  {
    name: "Reproduction",
    agentName: "senior-dev",
    approvalGate: false,
    expectedArtifacts: ["repro.md"],
    prompt:
      "Reproduce the bug described in the request below. Save repro.md with: the exact steps or command " +
      "that trigger it, the observed behaviour, the expected behaviour, and the environment (branch, " +
      "commit, versions). Paste the real output you got — not a summary of it. If you cannot reproduce " +
      "it, say so explicitly in repro.md, list what you tried, and stop there rather than guessing.",
  },
  {
    name: "Root cause diagnosis",
    agentName: "senior-dev",
    approvalGate: false,
    expectedArtifacts: ["diagnostic.md"],
    prompt:
      "Read repro.md from the run artifacts and find the ROOT CAUSE. Save diagnostic.md with: the code " +
      "path from the entry point to the faulty line (file:line), WHY the code is wrong — not just where " +
      "— the invariant it breaks, and the blast radius (what else relies on that code). Do not fix " +
      "anything at this step, and do not describe a symptom as a cause.",
  },
  {
    name: "Failing test",
    agentName: "senior-dev",
    approvalGate: false,
    expectedArtifacts: ["failing-test.md"],
    prompt:
      "Write the regression test BEFORE any fix, and prove it fails. Add a test that targets the root " +
      "cause described in diagnostic.md, using the project's existing test setup — no new dependency. " +
      "Run it and keep the failure output. Save failing-test.md with: the test file and its path, the " +
      "exact command to run it, and the VERBATIM failing output. Do not touch production code at this " +
      "step: a test that passes here proves nothing, and means the test is wrong, not the bug absent.",
  },
  {
    name: "Minimal fix",
    agentName: "senior-dev",
    approvalGate: false,
    expectedArtifacts: ["fix.md"],
    prompt:
      "Apply the SMALLEST fix that addresses the root cause in diagnostic.md — no refactor, no drive-by " +
      "cleanup, no rename. Then run the test from failing-test.md and the whole project test suite. " +
      "Save fix.md with: the diff, the same command as failing-test.md now passing (paste the output), " +
      "the full-suite result, and anything you deliberately left alone.",
  },
  {
    name: "Review",
    agentName: "review-coordinator",
    approvalGate: true,
    expectedArtifacts: ["review.md"],
    prompt:
      "Review the whole chain: repro.md → diagnostic.md → failing-test.md → fix.md. Check, in this order: " +
      "(1) the test was written before the fix and its failure output is real, (2) it would still fail " +
      "if the fix were reverted, (3) the fix addresses the cause and not the symptom, (4) it stays " +
      "minimal, (5) nothing else broke. Save review.md with a verdict and must-fix/should-fix items, " +
      "then leave the task for human approval.",
  },
];

export const BUILTIN_CHAINS: CatalogChain[] = [
  chain({
    name: "feature",
    description:
      "Interview (gate) → Probe (gate) → Breakdown (gate, approves the batch) → [slices] → Wiki → Human review (gate)",
    autoRunNext: true,
    steps: FEATURE_STEPS,
  }),
  chain({
    name: "bugfix",
    description:
      "Reproduction → Root cause → Failing test (written BEFORE the fix) → Minimal fix → Review (gate)",
    autoRunNext: true,
    steps: BUGFIX_STEPS,
  }),
];

// ---------------------------------------------------------------- pure logic
export function isBuiltinId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

export function builtinAgent(id: string): CatalogAgent | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === id);
}

export function builtinChain(id: string): CatalogChain | undefined {
  return BUILTIN_CHAINS.find((c) => c.id === id);
}

/** The agents a chain needs, resolved from nearest to furthest:
 *  the PROJECT's agents → the operator's library → the built-in catalog.
 *
 *  What matters here is the failure case: a step agent that cannot be found is RETURNED BY NAME.
 *  Falling back to the "default" agent would install a chain that looks right and would hand a
 *  security review to a generic agent — silently. */
export function resolveStepAgents(
  steps: TemplateStep[],
  sources: { projectAgentNames: string[]; library: AgentSpec[] },
): { toCreate: AgentSpec[]; missing: string[] } {
  const inProject = new Set(sources.projectAgentNames);
  const byName = new Map(sources.library.map((a) => [a.name, a]));
  const toCreate: AgentSpec[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    const name = step.agentName;
    if (inProject.has(name) || seen.has(name)) continue; // already there, or already planned
    seen.add(name);
    const spec = byName.get(name) ?? BUILTIN_AGENTS.find((a) => a.name === name);
    if (spec) toCreate.push({ ...spec });
    else missing.push(name);
  }
  return { toCreate, missing };
}

/** The catalog's own inconsistencies: a built-in chain pointing at an agent absent from the
 *  catalog would refuse to install on a blank project. Checked by a test. */
export function catalogInconsistencies(): string[] {
  const names = new Set(BUILTIN_AGENTS.map((a) => a.name));
  const errors: string[] = [];
  // D8's second argument, made executable: a built-in agent quoting a skill absent from the
  // built-in registry would arrive BROKEN on a fresh project — it would point at a folder nothing
  // writes, and the breakage would be silent (a skill that cannot be found is ignored at delivery
  // time, capabilities.ts:packSkills). Checked by a test, like chain steps.
  const skills = new Set(BUILTIN_SKILLS.map((s) => s.name));
  for (const a of BUILTIN_AGENTS)
    for (const s of a.skillNames)
      if (!skills.has(s))
        errors.push(
          `agent “${a.name}”: skill “${s}” is absent from the built-in registry (builtin-skills.ts)`,
        );
  for (const c of BUILTIN_CHAINS) {
    if (c.steps.length === 0) errors.push(`chain “${c.name}” has no step`);
    for (const s of c.steps) {
      if (!names.has(s.agentName))
        errors.push(
          `chain “${c.name}”, step “${s.name}”: agent “${s.agentName}” is absent from the catalog`,
        );
    }
  }
  return errors;
}

// ---------------------------------------------------------------- library (database)
const BUILTIN_UNDELETABLE =
  "built-in Legion entry (id “builtin:”) — it lives in the code, not in the database: " +
  "there is nothing to delete, and deleting it would bring it back at the next start. " +
  "To do without it, remove it from the project where it is installed.";

type LibraryFlag = { builtin: boolean };

/** GET /api/agent-templates: built-in catalog + agents promoted by the operator. */
export function listAgentLibrary(): (CatalogAgent & LibraryFlag & { createdAt: Date | null })[] {
  const promoted = promotedAgents();
  return [
    ...BUILTIN_AGENTS.map((a) => ({ ...a, builtin: true, createdAt: null })),
    ...promoted.map((t) => ({
      id: t.id,
      name: t.name,
      title: t.title,
      model: t.model,
      rolePrompt: t.rolePrompt,
      allowedTools: t.allowedTools,
      repoAccess: t.repoAccess,
      inboxAccess: t.inboxAccess,
      // `agent_templates` has no column for skills: a promoted entry carries none, and that is
      // not a regression — it carried no more before this field existed.
      skillNames: [],
      builtin: false,
      createdAt: t.createdAt as Date | null,
    })),
  ];
}

/** GET /api/chain-templates: built-in catalog + chains promoted by the operator. */
export function listChainLibrary(): (CatalogChain & LibraryFlag & { createdAt: Date | null })[] {
  const promoted = promotedChains();
  return [
    ...BUILTIN_CHAINS.map((c) => ({ ...c, builtin: true, createdAt: null })),
    ...promoted.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      steps: JSON.parse(t.steps) as TemplateStep[],
      autoRunNext: t.autoRunNext,
      builtin: false,
      createdAt: t.createdAt as Date | null,
    })),
  ];
}

/** A row of the operator's library, brought back to an `AgentSpec`. The conversion is not an
 *  identity: `agent_templates` has no column for skills, so a promoted entry arrives with `[]` —
 *  written here, once, rather than guessed at every call site. */
function templateToSpec(t: Omit<AgentSpec, "skillNames">): AgentSpec {
  return {
    name: t.name,
    title: t.title,
    model: t.model,
    rolePrompt: t.rolePrompt,
    allowedTools: t.allowedTools,
    repoAccess: t.repoAccess,
    inboxAccess: t.inboxAccess,
    skillNames: [],
  };
}

function libraryAgentSpecs(): AgentSpec[] {
  return promotedAgents().map(templateToSpec);
}

function agentValues(spec: AgentSpec & { networking?: "open" }, projectId: string, now: Date) {
  return {
    id: nanoid(10),
    projectId,
    name: spec.name,
    title: spec.title,
    model: spec.model,
    rolePrompt: spec.rolePrompt,
    allowedTools: spec.allowedTools,
    repoAccess: spec.repoAccess,
    inboxAccess: spec.inboxAccess,
    skillNames: JSON.stringify(spec.skillNames ?? []),
    // Nothing to set when the agent requires no network posture: `null` lets the server default
    // decide, as for the first five built-in agents (D19 concerns ONLY those whose capability
    // would be lost silently if the default flipped back).
    environmentId: spec.networking === NETWORKING.open ? ensureOpenEnvironment(projectId) : null,
    // Least privilege: the agent arrives with ITS folder, nothing else. The rest is granted by hand.
    fsGrants: JSON.stringify([
      { folderPath: `/agents/${spec.name}`, canRead: true, canWrite: true, canDelete: false },
    ]),
    createdAt: now,
  };
}

/** What it takes to create an agent FROM SCRATCH in a project — the name, the role prompt, and
 *  the few grants to set right away. Everything else (repos, rules, secrets, MCP) is granted
 *  afterwards through `PATCH /api/agents/:id`, as for an agent installed from the library. */
export type NewAgentInput = {
  name: string;
  title?: string;
  rolePrompt: string;
  model?: string | null;
  repoAccess?: RepoAccess;
  inboxAccess?: boolean;
  skillNames?: string[];
};

/** Creates a blank agent in a project (04/09).
 *
 *  THERE WAS NO WAY TO DO IT — neither through the API nor through the screen. An agent could
 *  only be born through `installAgent` (a library template, which imposes its name) or through
 *  the seed. Creating a "design" agent in a project therefore meant promoting an existing agent
 *  to a template, then instantiating it… under its old name, which nothing allows changing. The
 *  hole showed up the day we wanted a role that existed in no library.
 *
 *  Same collision rule as `installAgent`, same row construction (`agentValues`): an agent created
 *  by hand arrives with the same defaults as an installed one — its folder, nothing else — and
 *  not with defaults invented here. */
export function createAgent(projectId: string, input: NewAgentInput): { id: string } {
  const name = input.name.trim();
  if (!name) throw new CatalogError("the agent name is required", 400);
  // The name ends up in a path (`/agents/<name>`) and in the prompt: we keep it to what a folder
  // accepts without surprise, like the names of the built-in agents (`review-coordinator`).
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name))
    throw new CatalogError(
      "invalid agent name: lowercase letters, digits, hyphens and underscores, 40 characters at most",
      400,
    );
  const rolePrompt = input.rolePrompt.trim();
  if (!rolePrompt) throw new CatalogError("the role prompt (rolePrompt) is required", 400);
  if (!projectExists(projectId)) throw new CatalogError("project not found", 404);
  if (agentNamesOfProject(projectId).includes(name))
    throw new CatalogError(`an agent “${name}” already exists in this project`, 409);
  const spec: AgentSpec = {
    name,
    title: input.title?.trim() ?? "",
    model: input.model ?? null,
    rolePrompt,
    allowedTools: null,
    repoAccess: input.repoAccess ?? REPO_ACCESS.none,
    inboxAccess: input.inboxAccess ?? true,
    skillNames: input.skillNames ?? [],
  };
  const values = agentValues(spec, projectId, new Date());
  insertAgent(values);
  return { id: values.id };
}

/** Installs a library agent (built-in or promoted) into a project. */
export function installAgent(agentTemplateId: string, projectId: string): { id: string } {
  const promoted = isBuiltinId(agentTemplateId) ? undefined : promotedAgent(agentTemplateId);
  const spec: (AgentSpec & { networking?: "open" }) | undefined = isBuiltinId(agentTemplateId)
    ? builtinAgent(agentTemplateId)
    : promoted && templateToSpec(promoted);
  if (!spec) throw new CatalogError("template not found", 404);
  if (!projectExists(projectId)) throw new CatalogError("project not found", 404);
  if (agentNamesOfProject(projectId).includes(spec.name))
    throw new CatalogError(`an agent “${spec.name}” already exists in this project`, 409);
  const values = agentValues(spec, projectId, new Date());
  insertAgent(values);
  return { id: values.id };
}

/** Installs a chain into a project: copies it into `task_templates` AND creates the missing step
 *  agents. ONE transaction — a half-installed chain is worse than none. */
export function installChain(
  chainTemplateId: string,
  projectId: string,
): { id: string; createdAgents: string[] } {
  const spec: ChainSpec | undefined = isBuiltinId(chainTemplateId)
    ? builtinChain(chainTemplateId)
    : (() => {
        const row = promotedChain(chainTemplateId);
        return row
          ? {
              name: row.name,
              description: row.description,
              steps: JSON.parse(row.steps) as TemplateStep[],
              autoRunNext: row.autoRunNext,
            }
          : undefined;
      })();
  if (!spec) throw new CatalogError("chain not found in the library", 404);
  if (!projectExists(projectId)) throw new CatalogError("project not found", 404);
  if (spec.steps.length === 0) throw new CatalogError(`chain “${spec.name}” has no step`, 400);

  const projectAgentNames = agentNamesOfProject(projectId);
  const alreadyInstalled = chainsOfProject(projectId).some((t) => t.name === spec.name);
  if (alreadyInstalled)
    throw new CatalogError(`chain “${spec.name}” is already installed in this project`, 409);

  const { toCreate, missing } = resolveStepAgents(spec.steps, {
    projectAgentNames,
    library: libraryAgentSpecs(),
  });
  // We NAME the missing ones: "agent not found" helps nobody repair anything.
  if (missing.length > 0)
    throw new CatalogError(
      `step agent(s) not found: ${missing.join(", ")} — create them in the project or promote them ` +
        `to the library before installing “${spec.name}”`,
      409,
    );

  const now = new Date();
  const id = nanoid(10);
  insertChainWithAgents(
    toCreate.map((a) => agentValues(a, projectId, now)),
    {
      id,
      projectId,
      name: spec.name,
      description: spec.description,
      steps: JSON.stringify(spec.steps),
      autoRunNext: spec.autoRunNext,
      createdAt: now,
    },
  );
  return { id, createdAgents: toCreate.map((a) => a.name) };
}

/** A project's chain joins the operator's library — upsert by name, like agent promotion:
 *  promoting again updates the library's version. */
export function promoteChain(taskTemplateId: string): { id: string; updated: boolean } {
  const tpl = projectChain(taskTemplateId);
  if (!tpl) throw new CatalogError("chain not found", 404);
  if (BUILTIN_CHAINS.some((c) => c.name === tpl.name))
    throw new CatalogError(
      `“${tpl.name}” is a built-in chain: it is already available on every project. ` +
        `Rename your version before promoting it, otherwise the library would show two entries with the same name.`,
      409,
    );
  const values = { description: tpl.description, steps: tpl.steps, autoRunNext: tpl.autoRunNext };
  const existing = promotedChains().find((c) => c.name === tpl.name);
  if (existing) {
    updateChainSpec(existing.id, values);
    return { id: existing.id, updated: true };
  }
  const id = nanoid(10);
  insertPromotedChain({ id, name: tpl.name, ...values, createdAt: new Date() });
  return { id, updated: false };
}

/** Removes a project's copy. Refuses as long as an unfinished task carries this `template_id`:
 *  `onTaskDone` re-reads the template to decide whether to chain on (autoRunNext) — deleting the
 *  row from under a running chain would make it stop at the next step, without saying so. */
export function uninstallChain(taskTemplateId: string): { name: string } {
  if (isBuiltinId(taskTemplateId)) throw new CatalogError(BUILTIN_UNDELETABLE, 409);
  const tpl = projectChain(taskTemplateId);
  if (!tpl) throw new CatalogError("chain not found", 404);
  const running = tasksOfChain(taskTemplateId).filter((t) => t.status !== TASK_STATUS.done);
  if (running.length > 0)
    throw new CatalogError(
      `${running.length} unfinished task(s) still follow this chain (${running
        .slice(0, 3)
        .map((t) => t.name)
        .join(" · ")}` + `${running.length > 3 ? " …" : ""}) — finish or delete them first`,
      409,
    );
  deleteProjectChain(taskTemplateId);
  return { name: tpl.name };
}

/** Removes an entry from the operator's library. A built-in entry answers 409. */
export function deleteLibraryEntry(kind: "agent" | "chain", id: string): void {
  if (isBuiltinId(id)) throw new CatalogError(BUILTIN_UNDELETABLE, 409);
  if (kind === "agent") {
    if (!promotedAgent(id)) throw new CatalogError("agent template not found", 404);
    deletePromotedAgent(id);
    return;
  }
  if (!promotedChain(id)) throw new CatalogError("library chain not found", 404);
  deletePromotedChain(id);
}

/** The chains installed in a project, with their steps already decoded. */
export function listProjectChains(
  projectId: string,
): (ChainSpec & { id: string; projectId: string })[] {
  return chainsOfProject(projectId).map((t) => ({
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    description: t.description,
    steps: JSON.parse(t.steps) as TemplateStep[],
    autoRunNext: t.autoRunNext,
  }));
}
