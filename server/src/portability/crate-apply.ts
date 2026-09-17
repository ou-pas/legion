// Opening a crate into this database.
//
// Import always creates a new project (operator's choice, 26/08): no merge, no replace, nothing
// existing touched. It is the only version where nothing can be lost; replacing would need its own
// confirmation screen, since overwriting hand-configured agents is not a detail.
//
// Two steps on purpose. `summarizeCrate` does not touch the database: it validates the shape and
// says what would be created. `applyCrate` writes, in one transaction. A screen and a human sit
// between the two.
import { nanoid } from "nanoid";
import { encryptSecret } from "../shared/crypto.js";
import {
  inImportTransaction,
  insertAgent,
  insertEnvironment,
  insertMcpServer,
  insertProject,
  insertRepo,
  insertRule,
  insertSecret,
  insertTaskTemplate,
  projectSlugTaken,
  setProjectChainBindings,
} from "./crate-apply-store.js";
import { CRATE_FORMAT } from "./crate.js";
import type { CratePayload } from "./crate-collect.js";
import { NETWORKING } from "../shared/enums.js";
import { REPO_ACCESS } from "../shared/enums.js";
import { assertImportedRepoUrlAllowed } from "../projects/repo-url.js";

type PayloadAgent = CratePayload["agents"][number];

export interface CrateSummary {
  project: string;
  counts: {
    environments: number;
    agents: number;
    repos: number;
    rules: number;
    mcpServers: number;
    templates: number;
    secrets: number;
  };
  /** What the import will not do, for a human to read before confirming. */
  notes: string[];
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Validates an opened crate's shape and describes what it would produce. No writes. */
export function summarizeCrate(raw: unknown): CrateSummary {
  const p = raw as CratePayload | null;
  if (!p || typeof p !== "object" || !p.project || typeof p.project.name !== "string")
    throw new Error("crate opened, but its content does not have the expected shape");
  if (typeof p.format === "number" && p.format > CRATE_FORMAT)
    throw new Error(`crate written by a newer version (format ${p.format})`);
  // Repository hosts must be allowed forges (06/09, audit wave 2). A crate is the only way a `repos`
  // row enters without coming from the UI: a file written on another machine. Without this check,
  // importing a crate was enough to make the project token be presented to whatever host it named.
  //
  // This is the only place `LEGION_FORGE_HOSTS` decides (08/09): elsewhere the operator types the
  // URL and picks the forge, and that act is the authorisation (see the header of `repo-url.ts`).
  //
  // Refused here rather than in `applyCrate` so the preview shows it before confirmation.
  for (const r of asArray<CratePayload["repos"][number]>(p.repos)) {
    const checked = assertImportedRepoUrlAllowed(String(r.url ?? ""));
    if (!checked.ok) throw new Error(`repo “${r.name}”: ${checked.error}`);
  }

  const counts = {
    environments: asArray(p.environments).length,
    agents: asArray(p.agents).length,
    repos: asArray(p.repos).length,
    rules: asArray(p.rules).length,
    mcpServers: asArray(p.mcpServers).length,
    templates: asArray(p.taskTemplates).length,
    secrets: asArray(p.secrets).length,
  };

  return { project: p.project.name, counts, notes: crateNotes(p, counts.secrets) };
}

function crateNotes(p: CratePayload, secrets: number): string[] {
  const notes: string[] = [];
  if (secrets > 0)
    notes.push(`${secrets} secret(s) will be re-encrypted under this machine's master key.`);
  else notes.push("This crate holds no secret: agents that expect one will start without it.");
  const skills = referencedSkills(p);
  if (skills.size)
    notes.push(
      `${skills.size} skill(s) are referenced by name. Their content does not travel: a name with no folder behind it will be ignored.`,
    );
  if (asArray<PayloadAgent>(p.agents).some((a) => (a.fsGrants ?? "[]") !== "[]"))
    notes.push("Folder grants describe the original machine. Check them after the import.");
  notes.push(
    "Nothing else is touched: not the existing projects, not the runners, not the global settings.",
  );
  return notes;
}

function referencedSkills(p: CratePayload): Set<string> {
  const skills = new Set<string>();
  for (const a of asArray<PayloadAgent>(p.agents)) {
    try {
      for (const s of JSON.parse(a.skillNames ?? "[]") as string[]) skills.add(s);
    } catch {
      /* unreadable list: nothing to report beyond what delivery will say */
    }
  }
  return skills;
}

function freeSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `project-${nanoid(4)}`;
  let slug = base;
  for (let i = 2; projectSlugTaken(slug); i += 1) slug = `${base}-${i}`;
  return slug;
}

export interface CrateApplied {
  projectId: string;
  slug: string;
  summary: CrateSummary;
}

/** What the import gives the new project. None of it comes from the crate. */
interface ImportedProject {
  projectId: string;
  name: string;
  slug: string;
  now: Date;
}

/** Crate names mapped to ids of this database. A name with no row is absent: the agent loses the
 *  reference instead of gaining a ghost grant. */
interface CrateLinks {
  envId: Map<string, string>;
  ruleId: Map<string, string>;
  mcpId: Map<string, string>;
}

// oxlint-disable-next-line complexity -- one fallback per project column: a mapping table, not code paths
function importProject(p: CratePayload, into: ImportedProject): void {
  insertProject({
    id: into.projectId,
    name: into.name,
    slug: into.slug,
    defaultModel: p.project.defaultModel || "sonnet",
    repoUrl: p.project.repoUrl ?? null,
    // Never copied: it names a folder on the original machine. `null` means the default,
    // LEGION_DATA/fs/<slug>.
    fsRoot: null,
    context: p.project.context ?? "",
    demo: false,
    gitAuthorName: p.project.gitAuthorName ?? null,
    gitAuthorEmail: p.project.gitAuthorEmail ?? null,
    modelRouting: p.project.modelRouting || '{"low":"haiku","high":"opus"}',
    defaultSkillNames: p.project.defaultSkillNames || "[]",
    chainBindings: "{}", // filled after the agents, whose ids do not exist yet
    createdAt: into.now,
  });
}

/** Environments always travel with agents: without its own, a `limited` agent would fall back to
 *  `open`. */
function importEnvironments(p: CratePayload, into: ImportedProject): Map<string, string> {
  const envId = new Map<string, string>();
  for (const e of asArray<CratePayload["environments"][number]>(p.environments)) {
    const id = nanoid(10);
    envId.set(e.name, id);
    insertEnvironment({
      id,
      projectId: into.projectId,
      name: e.name,
      networking: e.networking === NETWORKING.limited ? "limited" : "open",
      allowedHosts: e.allowedHosts || "[]",
    });
  }
  return envId;
}

function importRepos(p: CratePayload, into: ImportedProject): void {
  for (const r of asArray<CratePayload["repos"][number]>(p.repos))
    insertRepo({
      id: nanoid(10),
      projectId: into.projectId,
      name: r.name,
      url: r.url,
      forge: r.forge ?? null,
      testCommand: r.testCommand ?? null,
      createdAt: into.now,
    });
}

function importRules(p: CratePayload, into: ImportedProject): Map<string, string> {
  const ruleId = new Map<string, string>();
  for (const r of asArray<CratePayload["rules"][number]>(p.rules)) {
    const id = nanoid(10);
    ruleId.set(r.name, id);
    insertRule({
      id,
      projectId: into.projectId,
      name: r.name,
      content: r.content,
      allAgents: Boolean(r.allAgents),
      status: r.status === "suggested" ? "suggested" : "active",
      createdAt: into.now,
    });
  }
  return ruleId;
}

function importMcpServers(p: CratePayload, into: ImportedProject): Map<string, string> {
  const mcpId = new Map<string, string>();
  for (const m of asArray<CratePayload["mcpServers"][number]>(p.mcpServers)) {
    const id = nanoid(10);
    mcpId.set(m.name, id);
    insertMcpServer({
      id,
      projectId: into.projectId,
      name: m.name,
      config: m.config,
      allowedHosts: m.allowedHosts || "[]",
      allAgents: Boolean(m.allAgents),
      createdAt: into.now,
    });
  }
  return mcpId;
}

/** Re-encrypted under this machine's master key; the crate carried them under its passphrase. */
function importSecrets(p: CratePayload, into: ImportedProject): void {
  for (const s of asArray<CratePayload["secrets"][number]>(p.secrets))
    insertSecret({
      id: nanoid(10),
      projectId: into.projectId,
      name: s.name,
      ciphertext: encryptSecret(s.value),
      createdAt: into.now,
    });
}

// oxlint-disable-next-line complexity -- one fallback per agent column: a mapping table, not code paths
function importAgents(
  p: CratePayload,
  into: ImportedProject,
  links: CrateLinks,
): Map<string, string> {
  const agentId = new Map<string, string>();
  for (const a of asArray<PayloadAgent>(p.agents)) {
    const id = nanoid(10);
    agentId.set(a.name, id);
    insertAgent({
      id,
      projectId: into.projectId,
      name: a.name,
      title: a.title ?? "",
      model: a.model ?? null,
      effort: (a.effort ?? null) as never,
      thinking: (a.thinking ?? null) as never,
      thinkingBudget: a.thinkingBudget ?? null,
      rolePrompt: a.rolePrompt ?? "",
      runnerPreference: a.runnerPreference ?? null,
      environmentId: a.environmentName ? (links.envId.get(a.environmentName) ?? null) : null,
      fsGrants: a.fsGrants || "[]",
      allowedTools: a.allowedTools ?? null,
      envSecretNames: a.envSecretNames || "[]",
      repoAccess: (a.repoAccess === REPO_ACCESS.read || a.repoAccess === REPO_ACCESS.write
        ? a.repoAccess
        : REPO_ACCESS.none) as never,
      inboxAccess: a.inboxAccess !== false,
      browserAccess: Boolean(a.browserAccess),
      mcpServerIds: JSON.stringify(
        (a.mcpServerNames ?? []).map((n) => links.mcpId.get(n)).filter(Boolean),
      ),
      ruleIds: JSON.stringify((a.ruleNames ?? []).map((n) => links.ruleId.get(n)).filter(Boolean)),
      skillNames: a.skillNames || "[]",
      repoNames: a.repoNames || "[]",
      createdAt: into.now,
    });
  }
  return agentId;
}

/** A role whose agent was not imported is dropped. */
function importChainBindings(
  p: CratePayload,
  into: ImportedProject,
  agentId: Map<string, string>,
): void {
  const bindings: Record<string, string> = {};
  for (const [role, agent] of Object.entries(p.project.chainBindings ?? {})) {
    const id = agentId.get(agent);
    if (id) bindings[role] = id;
  }
  if (Object.keys(bindings).length)
    setProjectChainBindings(into.projectId, JSON.stringify(bindings));
}

function importTaskTemplates(p: CratePayload, into: ImportedProject): void {
  for (const t of asArray<CratePayload["taskTemplates"][number]>(p.taskTemplates))
    insertTaskTemplate({
      id: nanoid(10),
      projectId: into.projectId,
      name: t.name,
      description: t.description ?? "",
      steps: t.steps,
      autoRunNext: t.autoRunNext !== false,
      createdAt: into.now,
    });
}

/** Creates the project and everything the crate carries in one transaction.
 *
 *  The order is the behaviour: environments, rules and MCP servers go before agents because their
 *  new ids replace the crate's names, and chain bindings go after agents for the same reason. */
export function applyCrate(raw: unknown, name?: string): CrateApplied {
  const summary = summarizeCrate(raw);
  const p = raw as CratePayload;
  const projectName = (name ?? "").trim() || p.project.name;
  const into: ImportedProject = {
    projectId: nanoid(10),
    name: projectName,
    slug: freeSlug(projectName),
    now: new Date(),
  };

  inImportTransaction(() => {
    importProject(p, into);
    const envId = importEnvironments(p, into);
    importRepos(p, into);
    const ruleId = importRules(p, into);
    const mcpId = importMcpServers(p, into);
    importSecrets(p, into);
    const agentId = importAgents(p, into, { envId, ruleId, mcpId });
    importChainBindings(p, into, agentId);
    importTaskTemplates(p, into);
  });

  return { projectId: into.projectId, slug: into.slug, summary };
}
