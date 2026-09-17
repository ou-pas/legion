import { json, post } from "./client.js";

/** Reasoning effort, mirror of the server's `AGENT_EFFORT`. Not a task's complexity: complexity
 *  ROUTES the model, effort sets its intensity. Both share `low` and `high`, hence two constants. */
export const AGENT_EFFORT = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const;
export const AGENT_EFFORTS = [
  AGENT_EFFORT.low,
  AGENT_EFFORT.medium,
  AGENT_EFFORT.high,
  AGENT_EFFORT.xhigh,
  AGENT_EFFORT.max,
] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

/** `adaptive` lets the model decide, and that is not neutral: forcing `enabled` on a trivial task
 *  costs tokens and improves nothing. */
export const AGENT_THINKING = {
  adaptive: "adaptive",
  enabled: "enabled",
  disabled: "disabled",
} as const;
export const AGENT_THINKINGS = [
  AGENT_THINKING.adaptive,
  AGENT_THINKING.enabled,
  AGENT_THINKING.disabled,
] as const;
export type AgentThinking = (typeof AGENT_THINKINGS)[number];

/** `suggested` = proposed by memory (a human correction turned into a rule), awaiting approval. */
export const RULE_STATUS = { active: "active", suggested: "suggested" } as const;
export const RULE_STATUSES = [RULE_STATUS.active, RULE_STATUS.suggested] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** An agent's repository access, mirror of `REPO_ACCESS` (server/src/shared/enums.ts). `read`
 *  clones without pushing: that makes an audit task safe, and is why such a task never opens a PR. */
export const REPO_ACCESS = { none: "none", read: "read", write: "write" } as const;
export const REPO_ACCESSES = [REPO_ACCESS.none, REPO_ACCESS.read, REPO_ACCESS.write] as const;
export type RepoAccess = (typeof REPO_ACCESSES)[number];

export type Agent = {
  id: string;
  projectId: string;
  name: string;
  title: string;
  model: string | null;
  /** What the agent IS, composed into its system prompt under "## Role" (buildSpec). Editable
   *  since #24 via patchAgent; refused (409) while one of the agent's sessions is alive. */
  rolePrompt: string;
  environmentId: string | null;
  fsGrants: string;
  allowedTools: string | null;
  envSecretNames: string;
  repoAccess: "none" | "read" | "write";
  inboxAccess: boolean;
  /** The agent's preferred machine: a runner NAME, SOFT (sorted first, falls back to the least
   *  loaded if it does not answer). `null` = no preference. Unlike a task's HARD machine
   *  (`Task["chosenRunnerId"]` in api/tasks.ts), which never falls back. */
  runnerPreference: string | null;
  /** The runner's shared browser (v30): a UI verification grant, off by default. */
  browserAccess: boolean;
  /** Two distinct model axes (v17). `null` = nothing set, the SDK decides. */
  effort: EffortLevel | null;
  thinking: ThinkingMode | null;
  thinkingBudget: number | null;
  mcpServerIds: string;
  skillNames: string;
  ruleIds: string; // JSON string[]
  repoNames: string; // JSON string[] of granted repos
};

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingMode = "adaptive" | "enabled" | "disabled";
export type AgentTemplate = {
  id: string;
  name: string;
  title: string;
  model: string | null;
  repoAccess: "none" | "read" | "write";
  inboxAccess: boolean;
  /** Built-in entry (id "builtin:"): lives in server code, not the database. It installs into a
   *  project but cannot be deleted (409). */
  builtin: boolean;
  /** null for a built-in entry: it has no creation date in the database. */
  createdAt: string | null;
};

export const agentsApi = {
  agentTemplates: (): Promise<AgentTemplate[]> => fetch("/api/agent-templates").then(json),
  promoteAgent: (agentId: string) => post(`/api/agents/${agentId}/promote`),
  deleteAgentTemplate: (id: string) =>
    fetch(`/api/agent-templates/${id}`, { method: "DELETE" }).then(json),
  instantiateAgentTemplate: (id: string, projectId: string) =>
    post(`/api/agent-templates/${id}/instantiate`, { projectId }),
  patchAgent: (
    id: string,
    body: {
      model?: string | null;
      mcpServerIds?: string[];
      skillNames?: string[];
      ruleIds?: string[];
      repoNames?: string[];
      repoAccess?: "none" | "read" | "write";
      envSecretNames?: string[];
      browserAccess?: boolean;
      /** `null` removes the preference; absent leaves it untouched. */
      runnerPreference?: string | null;
      inboxAccess?: boolean;
      effort?: EffortLevel | null;
      thinking?: ThinkingMode | null;
      thinkingBudget?: number | null;
      /** Refused: 400 if empty or > 20,000 chars, named 409 if one of the agent's sessions lives (#24). */
      rolePrompt?: string;
      /** `null` = default set (DEFAULT_TOOLS). Otherwise an allowlist: each name must be in
       *  BASE_SDK_TOOLS/LEGION_MCP_TOOLS, or `mcp__<server>[__<tool>]` for a server granted to this
       *  agent, else a named 400. With `inboxAccess`, REQUIRED_INBOX_TOOLS must stay, else a named
       *  400. See server/src/capabilities/tool-grants.ts. */
      allowedTools?: string[] | null;
    },
  ) =>
    fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json),
};
