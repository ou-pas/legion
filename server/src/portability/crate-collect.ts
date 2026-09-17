// What goes into a crate, and what does not.
//
// A crate is configuration, not a backup: the project, its agents and grants, repositories, rules,
// MCP servers, templates, and secrets if asked. No tasks, sessions, artifacts or history.
//
// No local id travels. An agent says `mcpServerNames: ["figma"]`, not `mcpServerIds: [aZ3…]`, so
// import creates fresh rows without reconciling nanoids across databases, and an opened crate is
// human-readable.
//
// One exception to the checkboxes: environments always travel with agents. An environment carries
// the network policy; an agent imported without it would fall back to `open`, a silent privilege
// widening.
import { decryptSecret } from "../shared/crypto.js";
import {
  agentRowsOf,
  environmentRowsOf,
  mcpServerRowsOf,
  projectRow,
  repoRowsOf,
  ruleRowsOf,
  secretRowsOf,
  taskTemplateRowsOf,
} from "./crate-collect-store.js";
import { CRATE_FORMAT } from "./crate.js";

/** Parts that can be unchecked. The project itself is not one: without it there is nothing to
 *  import. */
export const CRATE_PARTS = [
  "agents",
  "repos",
  "mcpServers",
  "rules",
  "templates",
  "secrets",
] as const;
export type CratePart = (typeof CRATE_PARTS)[number];
export type CrateInclude = Record<CratePart, boolean>;

/** Secrets are unchecked by default: carrying credentials is a decision, not a default (operator's
 *  choice, 26/08). Everything else is checked, since an accidentally incomplete crate is discovered
 *  at import, too late. */
export const DEFAULT_INCLUDE: CrateInclude = {
  agents: true,
  repos: true,
  mcpServers: true,
  rules: true,
  templates: true,
  secrets: false,
};

export interface CrateAgent {
  name: string;
  title: string;
  model: string | null;
  effort: string | null;
  thinking: string | null;
  thinkingBudget: number | null;
  rolePrompt: string;
  runnerPreference: string | null;
  environmentName: string | null;
  /** Folder paths as is. They describe the original machine; import copies them untranslated and
   *  they must be reviewed on the other side. */
  fsGrants: string;
  allowedTools: string | null;
  envSecretNames: string;
  repoAccess: string;
  inboxAccess: boolean;
  browserAccess: boolean;
  mcpServerNames: string[];
  ruleNames: string[];
  /** Folder names under `data/skills`. Skill content does not travel; a name with no folder is
   *  ignored at delivery, as everywhere else. */
  skillNames: string;
  repoNames: string;
}

export interface CratePayload {
  format: number;
  project: {
    name: string;
    defaultModel: string;
    repoUrl: string | null;
    context: string;
    gitAuthorName: string | null;
    gitAuthorEmail: string | null;
    modelRouting: string;
    defaultSkillNames: string;
    /** role → agent name (in the database: role → id). */
    chainBindings: Record<string, string>;
  };
  environments: { name: string; networking: string; allowedHosts: string }[];
  agents: CrateAgent[];
  repos: { name: string; url: string; forge: string | null; testCommand: string | null }[];
  rules: { name: string; content: string; allAgents: boolean; status: string }[];
  mcpServers: { name: string; config: string; allowedHosts: string; allAgents: boolean }[];
  taskTemplates: { name: string; description: string; steps: string; autoRunNext: boolean }[];
  secrets: { name: string; value: string }[];
}

export interface CrateManifest {
  project: string;
  slug: string;
  counts: Record<CratePart, number>;
}

/** What an export would contain, so the UI shows real counts before asking for a passphrase.
 *  Secrets are counted, never decrypted here. */
export function crateManifest(projectId: string): CrateManifest {
  const project = projectRow(projectId);
  if (!project) throw new Error("project not found");
  return {
    project: project.name,
    slug: project.slug,
    counts: {
      agents: agentRowsOf(projectId).length,
      repos: repoRowsOf(projectId).length,
      mcpServers: mcpServerRowsOf(projectId).length,
      rules: ruleRowsOf(projectId).length,
      templates: taskTemplateRowsOf(projectId).length,
      secrets: secretRowsOf(projectId).length,
    },
  };
}

function parseNames(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function collectCrate(projectId: string, include: CrateInclude): CratePayload {
  const project = projectRow(projectId);
  if (!project) throw new Error("project not found");

  const agents = include.agents ? agentRowsOf(projectId) : [];
  const environments = include.agents ? environmentRowsOf(projectId) : [];
  const repos = include.repos ? repoRowsOf(projectId) : [];
  const rules = include.rules ? ruleRowsOf(projectId) : [];
  const mcpServers = include.mcpServers ? mcpServerRowsOf(projectId) : [];
  const templates = include.templates ? taskTemplateRowsOf(projectId) : [];

  // An agent referencing an unchecked rule loses the reference: the rule will not exist on the
  // other side.
  const envName = new Map(environments.map((e) => [e.id, e.name]));
  const ruleName = new Map(rules.map((r) => [r.id, r.name]));
  const mcpName = new Map(mcpServers.map((m) => [m.id, m.name]));
  const agentName = new Map(agentRowsOf(projectId).map((a) => [a.id, a.name]));

  const chainBindings: Record<string, string> = {};
  try {
    const raw = JSON.parse(project.chainBindings) as Record<string, unknown>;
    for (const [role, id] of Object.entries(raw ?? {})) {
      const name = typeof id === "string" ? agentName.get(id) : undefined;
      if (name) chainBindings[role] = name;
    }
  } catch {
    /* unreadable mapping in the database: export without it rather than fail */
  }

  return {
    format: CRATE_FORMAT,
    project: {
      name: project.name,
      defaultModel: project.defaultModel,
      repoUrl: project.repoUrl,
      context: project.context,
      gitAuthorName: project.gitAuthorName,
      gitAuthorEmail: project.gitAuthorEmail,
      modelRouting: project.modelRouting,
      defaultSkillNames: project.defaultSkillNames,
      chainBindings,
    },
    environments: environments.map((e) => ({
      name: e.name,
      networking: e.networking,
      allowedHosts: e.allowedHosts,
    })),
    agents: agents.map((a) => ({
      name: a.name,
      title: a.title,
      model: a.model,
      effort: a.effort,
      thinking: a.thinking,
      thinkingBudget: a.thinkingBudget,
      rolePrompt: a.rolePrompt,
      runnerPreference: a.runnerPreference,
      environmentName: a.environmentId ? (envName.get(a.environmentId) ?? null) : null,
      fsGrants: a.fsGrants,
      allowedTools: a.allowedTools,
      envSecretNames: a.envSecretNames,
      repoAccess: a.repoAccess,
      inboxAccess: a.inboxAccess,
      browserAccess: a.browserAccess,
      mcpServerNames: parseNames(a.mcpServerIds)
        .map((id) => mcpName.get(id))
        .filter((x): x is string => Boolean(x)),
      ruleNames: parseNames(a.ruleIds)
        .map((id) => ruleName.get(id))
        .filter((x): x is string => Boolean(x)),
      skillNames: a.skillNames,
      repoNames: a.repoNames,
    })),
    repos: repos.map((r) => ({
      name: r.name,
      url: r.url,
      forge: r.forge,
      testCommand: r.testCommand,
    })),
    rules: rules.map((r) => ({
      name: r.name,
      content: r.content,
      allAgents: r.allAgents,
      status: r.status,
    })),
    mcpServers: mcpServers.map((m) => ({
      name: m.name,
      config: m.config,
      allowedHosts: m.allowedHosts,
      allAgents: m.allAgents,
    })),
    taskTemplates: templates.map((t) => ({
      name: t.name,
      description: t.description,
      steps: t.steps,
      autoRunNext: t.autoRunNext,
    })),
    // Decrypted with this machine's master key, then re-encrypted under the passphrase by
    // `sealCrate`. In between they are clear in memory only: never on disk, never in a log.
    secrets: include.secrets
      ? secretRowsOf(projectId).map((s) => ({ name: s.name, value: decryptSecret(s.ciphertext) }))
      : [],
  };
}
