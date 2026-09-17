// Model routing: task/step override → agent model → project default.
// v12: task complexity (low/med/high) routes the model when no explicit override is set.
// v24: the complexity → model mapping is no longer hard-coded; the operator sets it per project,
// including pinning a precise dated id. `project.modelRouting` is a JSON `{low?, med?, high?}`
// (column `model_routing`). A missing key or empty value falls back to the project default.
type TaskLike = { modelOverride: string | null; complexity?: "low" | "med" | "high" };
type AgentLike = { model: string | null };
type ProjectLike = { defaultModel: string; modelRouting?: string | null };

export const MODEL_ROUTING_LEVELS = ["low", "med", "high"] as const;
export type ModelRoutingLevel = (typeof MODEL_ROUTING_LEVELS)[number];
export type ModelRouting = Partial<Record<ModelRoutingLevel, string>>;

// The pre-v24 behaviour (ex-`BY_COMPLEXITY`), backfilled by the v24 migration on existing projects
// so nothing changed silently. Aliases, not dated ids (20/08): see the migration for the incident.
export const DEFAULT_MODEL_ROUTING: ModelRouting = { low: "haiku", high: "opus" };
export const DEFAULT_MODEL_ROUTING_JSON = JSON.stringify(DEFAULT_MODEL_ROUTING);

/** Reads `project.modelRouting` (raw JSON column). Tolerates anything an old or malformed row may
 *  carry (null, invalid JSON, non-object, unknown key, empty or non-string value): the key is just
 *  absent from the result, never an exception that would break model resolution. */
export function parseModelRouting(raw: string | null | undefined): ModelRouting {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ModelRouting = {};
  for (const level of MODEL_ROUTING_LEVELS) {
    const v = (parsed as Record<string, unknown>)[level];
    if (typeof v === "string" && v.trim()) out[level] = v.trim();
  }
  return out;
}

export function resolveModel(task: TaskLike, agent: AgentLike, project: ProjectLike): string {
  if (task.modelOverride) return task.modelOverride;
  if (agent.model) return agent.model;
  if (task.complexity) {
    const routed = parseModelRouting(project.modelRouting)[task.complexity];
    if (routed) return routed;
  }
  return project.defaultModel;
}

/** Validates `PATCH /api/projects/:id { modelRouting }`. An id unknown to `/api/models` (pinned
 *  by hand) is accepted, as for an agent's model (`capabilities/agent/routes.ts`): the screen flags
 *  the unknown, the API does not refuse it. `null` for a key (or omitting it) clears that level. */
export function validateModelRoutingInput(
  input: unknown,
): { ok: true; value: ModelRouting } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "modelRouting must be an object {low?, med?, high?}" };
  const out: ModelRouting = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(MODEL_ROUTING_LEVELS as readonly string[]).includes(key))
      return { ok: false, error: `unknown complexity level: ${key}` };
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || !value.trim())
      return { ok: false, error: `modelRouting.${key} must be a non-empty string` };
    out[key as ModelRoutingLevel] = value.trim();
  }
  return { ok: true, value: out };
}
