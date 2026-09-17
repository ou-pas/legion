// Editing an agent's card (06/09), the logic behind `PATCH /api/agents/:id`.
//
// `schemas.ts` already checks shapes; this module judges only what needs the database or
// context, which is what matters for security:
//
//  · The project boundary. Repositories, rules, secrets, MCP servers and environments granted to
//    an agent must belong to its project; otherwise an agent would carry another project's network
//    allowlist, keys or clones.
//  · Consistency between fields. `allowedTools` is judged against the MCP servers in effect after
//    this patch (granting a server and its tools in one call must work), and `effort` against the
//    effective model (the patch's, else the agent's, else the project default).
//
// One `update` once everything is valid: role and grants go together or not at all (the 05/09
// fix). A single statement, so atomic without a transaction.
import type * as schema from "../../../drizzle/schema.js";
import { effortAllowed, listModels } from "../../models/models.js";
import {
  getAgent,
  getEnvironment,
  getProject,
  mcpServerIdsOfProject,
  mcpServersOfProject,
  repoNamesOfProject,
  ruleIdsOfProject,
  secretNamesOfProject,
  updateAgent,
} from "./edit-store.js";
import { validateAgentRoleEdit } from "./role-edit.js";
import { listSkills } from "../capabilities.js";
import { validateAllowedTools } from "../tool-grants.js";
import type { AgentPatch } from "../schemas.js";

type AgentRow = typeof schema.agents.$inferSelect;

export type AgentEditResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string; live?: { id: string; status: string }[] };

/** Grants that are id lists from a project table. Anything outside the agent's project is refused
 *  by name, never filtered silently, or the box would stay ticked with nothing granted. */
const SCOPED_GRANTS = [
  {
    field: "repoNames",
    label: "repo(s) outside the project",
    known: repoNamesOfProject,
    write: (v: string): Partial<AgentRow> => ({ repoNames: v }),
  },
  {
    field: "ruleIds",
    label: "rule(s) outside the project",
    known: ruleIdsOfProject,
    write: (v: string): Partial<AgentRow> => ({ ruleIds: v }),
  },
  {
    field: "envSecretNames",
    label: "secret(s) outside the project",
    known: secretNamesOfProject,
    write: (v: string): Partial<AgentRow> => ({ envSecretNames: v }),
  },
  {
    field: "mcpServerIds",
    label: "MCP server(s) outside the project",
    known: mcpServerIdsOfProject,
    write: (v: string): Partial<AgentRow> => ({ mcpServerIds: v }),
  },
] as const satisfies readonly {
  field: keyof AgentPatch;
  label: string;
  known: (projectId: string) => string[];
  write: (v: string) => Partial<AgentRow>;
}[];

function scopedGrantFields(
  patch: AgentPatch,
  projectId: string,
): { ok: true; fields: Partial<AgentRow> } | { ok: false; error: string } {
  let fields: Partial<AgentRow> = {};
  for (const grant of SCOPED_GRANTS) {
    const asked = patch[grant.field];
    if (asked === undefined) continue;
    const known = new Set(grant.known(projectId));
    const bad = asked.filter((x) => !known.has(x));
    if (bad.length) return { ok: false, error: `${grant.label}: ${bad.join(", ")}` };
    fields = { ...fields, ...grant.write(JSON.stringify(asked)) };
  }
  return { ok: true, fields };
}

/** The agent's environment, its network wall. `null` removes it explicitly; otherwise it must
 *  belong to the project. */
function environmentField(
  environmentId: string | null,
  projectId: string,
): { ok: true; fields: Partial<AgentRow> } | { ok: false; error: string } {
  if (environmentId === null) return { ok: true, fields: { environmentId: null } };
  const env = getEnvironment(environmentId);
  if (!env || env.projectId !== projectId)
    return { ok: false, error: "environment outside the project" };
  return { ok: true, fields: { environmentId } };
}

/** Effort is refused on a model that ignores it, judged against the effective model: the patch's,
 *  else the agent's, else the project default. */
async function effortAllowedOnModel(
  patch: AgentPatch,
  agent: AgentRow,
  effort: string,
): Promise<string | null> {
  const target = patch.model !== undefined ? patch.model : agent.model;
  const project = getProject(agent.projectId);
  const effective = target || project?.defaultModel || "";
  if (!effective) return null;
  const { models } = await listModels();
  if (!effortAllowed(models, effective, effort))
    return `the “${effective}” model does not take an effort level`;
  return null;
}

/** `allowedTools`, the agent's least-privilege list (sessions/runner/spec.ts). `null` goes back to
 *  the default set, always consistent. A list goes through the allowlist (tool-grants.ts), which
 *  refuses unknown names and inconsistency with `inboxAccess`. */
function allowedToolsField(
  patch: AgentPatch,
  agent: AgentRow,
  tools: string[] | null,
): { ok: true; fields: Partial<AgentRow> } | { ok: false; error: string } {
  if (tools === null) return { ok: true, fields: { allowedTools: null } };
  // In effect after this patch, and additive like `resolveMcpServers` (v35): the project's
  // "all agents" servers are granted without being ticked.
  const granted = new Set(patch.mcpServerIds ?? (JSON.parse(agent.mcpServerIds) as string[]));
  const grantedMcpServerNames = mcpServersOfProject(agent.projectId)
    .filter((r) => r.allAgents || granted.has(r.id))
    .map((r) => r.name);
  // Same for `inboxAccess`, editable in this patch too.
  const result = validateAllowedTools(tools, {
    inboxAccess: patch.inboxAccess ?? agent.inboxAccess,
    grantedMcpServerNames,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, fields: { allowedTools: JSON.stringify(tools) } };
}

/** Fields written as-is once the schema passed. */
function plainFields(patch: AgentPatch): Partial<AgentRow> {
  return {
    ...(patch.model !== undefined ? { model: patch.model || null } : {}),
    ...(patch.repoAccess !== undefined ? { repoAccess: patch.repoAccess } : {}),
    ...(patch.browserAccess !== undefined ? { browserAccess: patch.browserAccess } : {}),
    ...(patch.runnerPreference !== undefined ? { runnerPreference: patch.runnerPreference } : {}),
    ...(patch.inboxAccess !== undefined ? { inboxAccess: patch.inboxAccess } : {}),
    ...(patch.thinking !== undefined ? { thinking: patch.thinking } : {}),
    ...(patch.thinkingBudget !== undefined ? { thinkingBudget: patch.thinkingBudget } : {}),
  };
}

export async function applyAgentEdit(agentId: string, patch: AgentPatch): Promise<AgentEditResult> {
  const agent = getAgent(agentId);
  if (!agent) return { ok: false, status: 404, error: "agent not found" };

  let fields: Partial<AgentRow> = plainFields(patch);

  // The role has its own guard (live session, length cap) in role-edit.ts; only it returns 409.
  if (patch.rolePrompt !== undefined) {
    const role = validateAgentRoleEdit(agent.id, patch.rolePrompt);
    if (!role.ok) return role;
    fields = { ...fields, rolePrompt: role.rolePrompt };
  }

  if (patch.environmentId !== undefined) {
    const env = environmentField(patch.environmentId, agent.projectId);
    if (!env.ok) return { ok: false, status: 400, error: env.error };
    fields = { ...fields, ...env.fields };
  }

  const grants = scopedGrantFields(patch, agent.projectId);
  if (!grants.ok) return { ok: false, status: 400, error: grants.error };
  fields = { ...fields, ...grants.fields };

  // Skills are global (on disk, not in the database): the guard is the folder's existence.
  if (patch.skillNames !== undefined) {
    const known = new Set(listSkills().map((s) => s.name));
    const bad = patch.skillNames.filter((x) => !known.has(x));
    if (bad.length) return { ok: false, status: 400, error: `unknown skill(s): ${bad.join(", ")}` };
    fields = { ...fields, skillNames: JSON.stringify(patch.skillNames) };
  }

  if (patch.effort !== undefined) {
    if (patch.effort !== null) {
      const refusal = await effortAllowedOnModel(patch, agent, patch.effort);
      if (refusal) return { ok: false, status: 400, error: refusal };
    }
    fields = { ...fields, effort: patch.effort };
  }

  if (patch.allowedTools !== undefined) {
    const tools = allowedToolsField(patch, agent, patch.allowedTools);
    if (!tools.ok) return { ok: false, status: 400, error: tools.error };
    fields = { ...fields, ...tools.fields };
  }

  if (Object.keys(fields).length === 0)
    return { ok: false, status: 400, error: "nothing to change" };
  updateAgent(agent.id, fields);
  return { ok: true };
}
