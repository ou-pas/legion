// sdk-options: what the runner grants the SDK, and what it refuses.
//
// Split from `runReal` on 06/09: ninety-five declarative lines in a function that only reads
// messages. It is the session's permission model in one place: `strictMcpConfig` ignoring any disk
// config, `settingSources` deciding whether the workspace's `.claude/` is read, `claudeMdExcludes`
// keeping one path from repository rules to the prompt, `allowedTools` coming from the spec and
// nowhere else. Reading them in sequence is the only way to check they agree.
//
// Pure: inputs in, an object out. It launches nothing.
import type { McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import type { SessionSpec } from "./session-spec.mjs";

/** What the runner passes: the spec, the workspace (`cwd`, outside any repository), the in-process
 *  MCP server and granted external servers, the skills actually written to disk, the system prompt
 *  assembled by prompt, the hooks mounted by session-hooks, and the abort controller.
 *
 *  `legion`, `externalMcp` and `hooks` pass through unread: they are placed in `options`, and the SDK
 *  types them when `query()` is called. */
type QueryDeps = {
  /** `model` is the only field this module requires. The others are read for presence (`effort`,
   *  `thinking`, `resume`) or passed as is: a spec without them produces the options it already
   *  produced. The full server contract is checked elsewhere (`payload-spec.test.ts`); this says
   *  what calling needs. */
  spec: Pick<SessionSpec, "model"> &
    Partial<Pick<SessionSpec, "effort" | "thinking" | "builtinTools" | "allowedTools" | "resume">>;
  cwd: string;
  legion: McpServerConfig;
  /** Passed through as the spec carries them: the payload reads no external server. Their shape is
   *  decided by the control plane and checked by the SDK at call time. */
  externalMcp: SessionSpec["mcpServers"];
  skillNames: string[];
  systemPrompt: string;
  hooks: Options["hooks"];
  abort: AbortController;
};

/** The `options` object of `query()`. */
export function buildQueryOptions({
  spec,
  cwd,
  legion,
  externalMcp,
  skillNames,
  systemPrompt,
  hooks,
  abort,
}: QueryDeps): Options {
  return {
    model: spec.model,
    // Two model axes (v17), omitted when the spec lacks them: an explicit `undefined` is not the
    // same as setting nothing, and the SDK's default must stay the default.
    ...(spec.effort ? { effort: spec.effort } : {}),
    ...(spec.thinking ? { thinking: spec.thinking } : {}),
    // v42: the `## Rules` section is assembled by the container and appended to the server's system
    // prompt, the only place both rule sources are visible at once. `## Workspace` joined it (30/08),
    // also only known after cloning. Both arrive already rendered by prompt.
    systemPrompt,
    cwd,
    // v61: native instruction loading, re-enabled. The flag was `[]` since 18/08, "never inherit
    // project hooks/settings", right at the time: `cwd` was `repoDir ?? LEGION_WORKDIR`, so it could
    // be a cloned repository, and `["project"]` would have run the client's hooks there.
    //
    // That premise fell when `repoDir` left the computation. `cwd` is now the workspace, outside any
    // repository, and the SDK reads `settings.json` (so hooks) only in `<cwd>/.claude/`, neither
    // above nor in children. Repository hooks are out of reach by the workspace's topology, not by
    // this flag, and the one file that would be read, `<cwd>/.claude/settings.json`, is erased at
    // every start by `pruneWorkspace()`.
    //
    // The gain: `.claude/rules/*.md` in the workspace are loaded by the SDK itself, so their `paths:`
    // frontmatter is honoured and a rule scoped to files only enters context when the session opens
    // one. The only mechanism that can lighten the rules the system prompt carries (23.9 kB then).
    //
    // `rulesSection` stays in the prompt for now, on purpose: removing the injection before proof
    // that native loading works would silently strip every session's guardrails. The proof is the
    // `InstructionsLoaded` hook (session-hooks). The duplication is temporary and deliberate.
    settingSources: ["project"],
    // v63: repository rules stay the runner's monopoly.
    //
    // Measured on a real fleet: `.claude/rules/` are versioned in repositories (13 files in one, 21 in
    // another of the same project). A `load_reason: 'nested_traversal'` would load them on top of
    // what capabilities already does, with two consequences:
    //
    //  · Weight. The largest of these files is 27 kB. `mergeRules` injects only 400 characters of it
    //    (`REPO_HEAD_MAX`) for lack of a summary; native loading would take all 27 kB and grow the
    //    context instead of lightening it.
    //  · The lock. `locked` exists because a repository file is written by anyone who can push,
    //    agents included: without it an agent loosens its own leash by committing
    //    `secrets-jamais-en-clair.md`. The docs are explicit, "no hard precedence rule between
    //    levels": two `.claude/rules/` files do not arbitrate each other. The lock can only exist if a
    //    single path leads to the prompt, the runner's.
    //
    // The exclusion is declared as programmatic settings, not in a file: `<cwd>/.claude/settings.json`
    // is exactly the path erased at startup because the agent can write to it. What lives in memory
    // cannot be overwritten.
    settings: { claudeMdExcludes: [`${cwd}/repos/*/.claude/rules/**`] },
    // Hooks are in-process callbacks, not scripts on disk: unrelated to the filesystem hooks the line
    // above makes readable, and they open no execution surface.
    //
    // `InstructionsLoaded` only reports. `PreToolUse` on Bash refuses: the difference between a
    // prompt instruction and a guarantee, which lets the `commits-conventionnels` rule (2.1 kB in
    // every prompt, on two projects) leave the prompt: what is checked no longer needs repeating.
    hooks,
    // Safety net against pathological loops, not a work limit: the stuck detector (stuck, question
    // asked by pause-guards) stops a stuck session. 40 killed healthy tasks, a real feature needs
    // more. Raised to 400 on 11/09 once inertia is queried continuously (`session-runner.mts`) and
    // not only at the turn budget's pause turn: a higher wall no longer lets an inert session spin
    // up to it.
    maxTurns: 400,
    permissionMode: "dontAsk",
    // MCP: legion (in-process) + granted external servers. strictMcpConfig ignores any disk config
    // (.mcp.json, settings): only the spec counts (least privilege).
    mcpServers: { legion, ...externalMcp } as Record<string, McpServerConfig>,
    strictMcpConfig: true,
    ...(skillNames.length ? { skills: skillNames } : {}),
    // v65: two lists, doing different jobs. The SDK docs are explicit: `allowedTools` = "auto-allowed
    // WITHOUT PROMPTING", and "to restrict which tools are available, use the `tools` option
    // instead". Legion long set only the first, under `permissionMode: "dontAsk"`: a list removing
    // confirmations nobody asked for, while the whole `claude_code` preset stayed available.
    // Measured on 08/09 over thirty tasks: `Agent` called seven times and `WebSearch` twice by agents
    // with neither in their grants.
    //
    // `tools` covers only built-in tools. MCP servers go through `mcpServers` above and stay guarded
    // by `allowedTools`, hence the two lists differ; both are computed on the server
    // (capabilities/tool-grants.ts).
    tools: spec.builtinTools,
    allowedTools: spec.allowedTools,
    abortController: abort,
    ...(spec.resume?.sdkSessionId ? { resume: spec.resume.sdkSessionId } : {}),
    stderr: (d: string) => process.stderr.write(`[cli] ${d}`),
  };
}
