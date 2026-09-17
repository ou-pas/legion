// Allowlist of tool names an `agents.allowedTools` may contain.
//
// `allowedTools` is an agent's least-privilege list. Without an allowlist, PATCH /api/agents/:id
// would let any name through, including an `mcp__<server>` prefix never granted to this agent.
//
// Accepted families:
//  1. base SDK tools Legion has vetted and can sandbox (BASE_SDK_TOOLS), not the whole Claude
//     Code catalogue (`Task`, `NotebookEdit`…), which no network review has covered. Widening
//     this list is a decision of its own, never a side effect.
//  1b. `WebSearch`/`WebFetch` (WEB_TOOLS): accepted, but not in DEFAULT_TOOLS; see below.
//  2. internal `mcp__legion__*` tools, never dependent on a project grant.
//  3. `mcp__<server>` or `mcp__<server>__<tool>` for an MCP server actually granted to this agent
//     (agents.mcpServerIds).
//
// `Agent` joined the base on 08/09, an operator decision: any agent may fan out sub-agents with no
// cap. It already described reality: the SDK's `allowedTools` only auto-allows without prompting
// (`tools` is what restricts), and over thirty tasks `Agent` was called seven times by agents
// that never had it. Granting it and setting `tools` (`resolveBuiltinTools`) makes the list match
// what the session can do.
export const BASE_SDK_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent"] as const;

/** Harness plumbing, never a grant.
 *
 *  These open no access the session lacks; they make usable what it has. `ToolSearch` loads a
 *  deferred tool's schema (64 calls over thirty tasks). `TaskOutput` reads a background sub-agent's
 *  result, `Agent`'s default mode. `Skill` serves the skills `spec.skills` already decided.
 *
 *  So they are outside `DEFAULT_TOOLS` (not chosen, not removable) and added to both spec lists:
 *  exposure (`resolveBuiltinTools`) and auto-allow (`exposedTools` in `sessions/runner/spec.ts`).
 *
 *  Both lists, not one (14/09): in `permissionMode: "dontAsk"` a tool outside `allowedTools` is
 *  refused, not asked about. For three months agents saw `Skill` and `TaskOutput` and could not
 *  call them. */
export const HARNESS_TOOLS = ["ToolSearch", "TaskOutput", "Skill"] as const;

/** The two web tools, kept apart from `BASE_SDK_TOOLS` and so outside `DEFAULT_TOOLS`: no agent
 *  gets them by default.
 *
 *  Decided in D18/D19 of `/artifacts/rtQLldYSm2/spec.md`. The network question was the missing
 *  half: the agent carrying them (`interviewer`) is installed with an explicit
 *  `networking: NETWORKING.open` environment, not the "no environment = no wall" default, which
 *  flipped twice in a month.
 *
 *  They must be in the allowlist, not just the catalogue: the allowlist judges every
 *  `allowedTools` value (#44), so without them re-saving the unchanged `interviewer` would
 *  answer 400. */
export const WEB_TOOLS = ["WebSearch", "WebFetch"] as const;

export const LEGION_MCP_TOOLS = [
  "mcp__legion__update_task",
  "mcp__legion__inbox_ask",
  "mcp__legion__inbox_send",
  "mcp__legion__propose_task",
  "mcp__legion__wait_for_task",
  "mcp__legion__fs_list",
  "mcp__legion__fs_read",
  "mcp__legion__fs_write",
  "mcp__legion__fs_mkdir",
  "mcp__legion__fs_delete",
] as const;

/** Default set for an agent without explicit `allowedTools` (NULL column), next to the allowlist
 *  that defines it. */
export const DEFAULT_TOOLS: string[] = [...BASE_SDK_TOOLS, ...LEGION_MCP_TOOLS];

/** `propose_task` and `wait_for_task` are gated like the inbox (agent.inboxAccess). */
export const INBOX_GATED_TOOLS = ["mcp__legion__propose_task", "mcp__legion__wait_for_task"];

/** The two tools that let an agent with `inboxAccess` actually talk to the human. Removing them
 *  while keeping `inboxAccess` on would be a silent contradiction (see validateAllowedTools). */
export const REQUIRED_INBOX_TOOLS = ["mcp__legion__inbox_ask", "mcp__legion__inbox_send"];

/** The six tools `coreTools` (runner-payload/mcp-tools.mts) always registers on the "legion" MCP
 *  server whatever `agentTools` says: task state and file gestures. No grant removes them, as
 *  with HARNESS_TOOLS, except these are in `LEGION_MCP_TOOLS` and so in the allowlist.
 *
 *  Regression fixed on 15/09 ("the agent says it has no access to artifacts",
 *  /artifacts/oa4vlYnCB2/): a custom `agentTools` could omit one of them, and `exposedTools` only
 *  added them to exposure, not auto-allow. In `permissionMode: "dontAsk"` the SDK silently
 *  refuses an exposed tool missing from `allowedTools`: the session saw `fs_write` and could not
 *  call it. */
export const CORE_MCP_TOOLS = LEGION_MCP_TOOLS.filter(
  (t) => !REQUIRED_INBOX_TOOLS.includes(t) && !INBOX_GATED_TOOLS.includes(t),
);

/** An agent's effective tool set: its own if declared, else DEFAULT_TOOLS. The other half of the
 *  guarantee is that the default passes its own validation (tool-grants.test.ts). */
export function resolveAgentTools(agent: { allowedTools: string | null }): string[] {
  return agent.allowedTools ? (JSON.parse(agent.allowedTools) as string[]) : DEFAULT_TOOLS;
}

/** The exposure list, the one that actually restricts (the SDK `tools` option).
 *
 *  Until 08/09 least privilege was wired only to `allowedTools`, which the SDK documents as
 *  "auto-allowed without prompting; to restrict, use `tools`". In `dontAsk` mode that restricted
 *  nothing: over thirty tasks, `WebSearch` and `WebFetch` were called by agents never granted
 *  them, and `Agent` seven times without a grant.
 *
 *  No `mcp__…` names here: `tools` covers built-in tools only; MCP servers are exposed through
 *  `mcpServers` and guarded by `allowedTools`.
 *
 *  @param granted the agent's effective set, gates already applied by the spec builder */
export function resolveBuiltinTools(granted: string[]): string[] {
  return [...new Set([...granted.filter((t) => !t.startsWith("mcp__")), ...HARNESS_TOOLS])];
}

export type ToolGrantContext = {
  /** Effective agents.inboxAccess: the current patch's value if it sets one, else the stored
   *  one. The caller resolves it. */
  inboxAccess: boolean;
  /** Names (not ids) of MCP servers granted to this agent after the current patch. The caller
   *  resolves them. */
  grantedMcpServerNames: string[];
};

export type ToolGrantResult = { ok: true } | { ok: false; error: string };

/**
 * Validates a proposed `allowedTools`: every name must belong to one of the families above, and
 * with effective `inboxAccess` both inbox tools must stay (a named refusal, never a silent fix).
 */
export function validateAllowedTools(tools: string[], ctx: ToolGrantContext): ToolGrantResult {
  const known = new Set<string>([...BASE_SDK_TOOLS, ...WEB_TOOLS, ...LEGION_MCP_TOOLS]);
  const invalid = tools.filter((t) => {
    if (known.has(t)) return false;
    if (t.startsWith("mcp__")) {
      const rest = t.slice("mcp__".length);
      return !ctx.grantedMcpServerNames.some(
        (server) => rest === server || rest.startsWith(`${server}__`),
      );
    }
    return true;
  });
  if (invalid.length) return { ok: false, error: `tool(s) not allowed: ${invalid.join(", ")}` };

  if (ctx.inboxAccess && !REQUIRED_INBOX_TOOLS.every((t) => tools.includes(t))) {
    return {
      ok: false,
      error:
        "the agent has inbox access on (inboxAccess): mcp__legion__inbox_ask and mcp__legion__inbox_send " +
        "must stay in allowedTools, otherwise it can no longer talk to the human and nothing says so",
    };
  }

  return { ok: true };
}
