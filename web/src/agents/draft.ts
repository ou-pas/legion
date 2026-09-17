// An agent's settings draft: what the operator changed but has not saved. One state object rather
// than ten `useState`s, so the detail page can pass its settings to the two blocks consuming them
// (fields and grant list) without fourteen props of plumbing.
import { type Agent } from "../api/agents.js";
export type AgentDraft = {
  /** "" = no model of its own: the agent runs on the project's. */
  model: string;
  effort: Agent["effort"];
  thinking: Agent["thinking"];
  thinkingBudget: number | null;
  repoAccess: Agent["repoAccess"];
  /** Preferred machine (v2c, nav); `null` = none, same path as `environmentId`. */
  runnerPreference: string | null;
  inboxAccess: boolean;
  /** Shared browser (v30), a plain boolean, same path as repoAccess. */
  browserAccess: boolean;
  /** Network environment (25/08); `null` = none. It had no UI before: only seed scripts wrote it,
   *  so the Environments screen was attached to nobody. */
  environmentId: string | null;
  mcpIds: string[];
  skillNames: string[];
  ruleIds: string[];
  repoNames: string[];
  envSecretNames: string[];
  /** `null` = default set (the server catalogue's `defaultTools`): nothing specific to this agent. */
  allowedTools: string[] | null;
};

/** Grants arrive as JSON in a text column. A malformed row must cost an empty list, not a blank
 *  screen. */
export function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export const draftOf = (agent: Agent): AgentDraft => ({
  model: agent.model ?? "",
  effort: agent.effort,
  thinking: agent.thinking,
  thinkingBudget: agent.thinkingBudget,
  repoAccess: agent.repoAccess,
  runnerPreference: agent.runnerPreference,
  inboxAccess: agent.inboxAccess,
  browserAccess: agent.browserAccess,
  environmentId: agent.environmentId,
  mcpIds: parseList(agent.mcpServerIds),
  skillNames: parseList(agent.skillNames),
  ruleIds: parseList(agent.ruleIds),
  repoNames: parseList(agent.repoNames),
  envSecretNames: parseList(agent.envSecretNames),
  // `parseList` takes a `string`, so the null check is required, not cosmetic:
  // `agent.allowedTools === null` is the default set, not an empty JSON column.
  allowedTools: agent.allowedTools === null ? null : parseList(agent.allowedTools),
});

/** A grant list's order means nothing: two identical sets ticked in another order are not a
 *  change. Exported for tool-grants.ts (normalizeTools). */
export const same = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** `same()` alone is not enough for `allowedTools`: `null` (default) and `[]` (own empty list) are
 *  not the same state, and `same(null, [])` would crash before comparing. */
const sameTools = (a: string[] | null, b: string[] | null): boolean =>
  a === null || b === null ? a === b : same(a, b);

export function isDirty(agent: Agent, d: AgentDraft): boolean {
  const ref = draftOf(agent);
  return (
    d.model !== ref.model ||
    d.repoAccess !== ref.repoAccess ||
    d.runnerPreference !== ref.runnerPreference ||
    d.inboxAccess !== ref.inboxAccess ||
    d.browserAccess !== ref.browserAccess ||
    d.environmentId !== ref.environmentId ||
    d.effort !== ref.effort ||
    d.thinking !== ref.thinking ||
    d.thinkingBudget !== ref.thinkingBudget ||
    !same(d.mcpIds, ref.mcpIds) ||
    !same(d.skillNames, ref.skillNames) ||
    !same(d.ruleIds, ref.ruleIds) ||
    !same(d.repoNames, ref.repoNames) ||
    !same(d.envSecretNames, ref.envSecretNames) ||
    !sameTools(d.allowedTools, ref.allowedTools)
  );
}

/** PATCH body. `model: null`, not `""`: the API tells "no model of its own" from "field absent". */
export const toPatch = (d: AgentDraft) => ({
  model: d.model || null,
  mcpServerIds: d.mcpIds,
  skillNames: d.skillNames,
  ruleIds: d.ruleIds,
  repoNames: d.repoNames,
  repoAccess: d.repoAccess,
  runnerPreference: d.runnerPreference,
  inboxAccess: d.inboxAccess,
  browserAccess: d.browserAccess,
  environmentId: d.environmentId,
  envSecretNames: d.envSecretNames,
  effort: d.effort,
  thinking: d.thinking,
  thinkingBudget: d.thinkingBudget,
  // The server tells `null` (default set) from an absent field: never `undefined` here.
  allowedTools: d.allowedTools,
});

export const toggled = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

/** An agent's data identity: passed as `key`, it resyncs the local draft when server data changes
 *  under it (e.g. an MCP server deleted elsewhere, review 5b #9). */
export const agentStateKey = (a: Agent) =>
  [
    a.id,
    a.mcpServerIds,
    a.skillNames,
    a.ruleIds,
    a.repoNames,
    a.envSecretNames,
    a.repoAccess,
    a.runnerPreference ?? "",
    String(a.inboxAccess),
    String(a.browserAccess),
    a.environmentId ?? "",
    a.model ?? "",
    a.effort ?? "",
    a.thinking ?? "",
    a.thinkingBudget ?? "",
    a.allowedTools ?? "",
  ].join(":");
