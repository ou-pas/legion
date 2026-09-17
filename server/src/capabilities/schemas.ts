// What a client may send to the capabilities domain: one schema per mutating body (06/09), after
// `sessions/internal-schemas.ts`. Until then `c.req.json<T>()` declared seven shapes and checked
// none, so any body reached `db.update`.
//
// `strictObject` everywhere: an unknown key is refused by name. `{ repoName: [...] }` instead of
// `repoNames` used to answer 200 and change nothing.
//
// Enums derive from the domain constants, never copied, or the schema would one day refuse a
// legitimate value.
//
// Not here: anything needing the database or context (an existing repository, an MCP server of
// the same project, a model supporting the effort, a taken name). Services name those faults
// better.
import { z } from "zod";
import { EFFORT_LEVELS, THINKING_MODES } from "../models/models.js";
import { REPO_ACCESSES } from "../shared/enums.js";
import { RULE_STATUSES } from "./agent/agent-enums.js";

/** POST /api/skills: a skill folder from the dropzone, file contents in base64. `saveSkill`
 *  judges paths (traversal, size, count). */
export const skillUploadBody = z.strictObject({
  name: z.string(),
  files: z.array(z.strictObject({ path: z.string(), b64: z.string() })),
});

/** An MCP server name becomes a tool prefix (`mcp__<name>__<tool>`) and a process name in the
 *  session spec, hence the restricted charset. "legion" is taken by the internal server, which a
 *  namesake would silently overwrite in the spec. */
const mcpServerName = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, "invalid name (a-z, 0-9, -, _)")
  .refine((n) => n !== "legion", "“legion” is reserved for the internal server");

/** POST /api/mcp-servers. `config` stays opaque here: its shape depends on the transport, and
 *  `invalidConfig` (mcp-edit.ts) names the missing field, which a `discriminatedUnion` would say
 *  less well. */
export const mcpServerBody = z.strictObject({
  projectId: z.string().min(1),
  name: mcpServerName,
  config: z.record(z.string(), z.unknown()),
  allowedHosts: z.array(z.string()).optional(),
  allAgents: z.boolean().optional(),
});

/** PATCH /api/mcp-servers/:id: the "all agents" checkbox only. */
export const mcpServerPatchBody = z.strictObject({ allAgents: z.boolean() });

export const instantiateBody = z.strictObject({ projectId: z.string().min(1) });

/** A rule's scope, shared by upsert and edit. `rule-edit.ts` checks `repoNames` against the
 *  project's real repositories. */
const ruleScopeFields = {
  summary: z.string().optional(),
  repoNames: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  allAgents: z.boolean().optional(),
};

/** POST /api/rules: upsert by (project, name). */
export const ruleUpsertBody = z.strictObject({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "name required"),
  content: z.string().trim().min(1, "content required"),
  locked: z.boolean().optional(),
  ...ruleScopeFields,
});

/** PATCH /api/rules/:id: everything optional, including status (activating a rule suggested by
 *  memory). */
export const rulePatchBody = z.strictObject({
  name: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(RULE_STATUSES).optional(),
  locked: z.boolean().optional(),
  ...ruleScopeFields,
});

/** PATCH /api/agents/:id: an agent's whole card, grants included.
 *
 *  Absent means "leave it", `null` means "remove it" (back to the project model, the default tool
 *  set, no environment). That is why no field is `.nullish()` for convenience. */
export const agentPatchBody = z.strictObject({
  model: z.string().nullable().optional(),
  rolePrompt: z.string().optional(),
  repoAccess: z.enum(REPO_ACCESSES).optional(),
  browserAccess: z.boolean().optional(),
  // v2c (nav): preferred machine (soft, see chosen-runner.ts) and inbox access, exposed on the
  // card; both existed in the database with no PATCH to write them.
  runnerPreference: z.string().min(1).nullable().optional(),
  inboxAccess: z.boolean().optional(),
  environmentId: z.string().nullable().optional(),
  repoNames: z.array(z.string()).optional(),
  ruleIds: z.array(z.string()).optional(),
  envSecretNames: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  skillNames: z.array(z.string()).optional(),
  effort: z.enum(EFFORT_LEVELS).nullable().optional(),
  thinking: z.enum(THINKING_MODES).nullable().optional(),
  // 1024 is the API's floor: below it the model ignores the budget, and an ignored setting is
  // worse than none.
  thinkingBudget: z
    .number()
    .int()
    .min(1024, "thinking budget: an integer ≥ 1024, or empty")
    .nullable()
    .optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
});

export type McpServerInput = z.infer<typeof mcpServerBody>;
export type RuleUpsert = z.infer<typeof ruleUpsertBody>;
export type RulePatch = z.infer<typeof rulePatchBody>;
export type AgentPatch = z.infer<typeof agentPatchBody>;
