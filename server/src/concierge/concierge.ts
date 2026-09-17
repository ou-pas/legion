// The concierge speaks from an ephemeral SDK session: one `query()` call, a haiku model, no
// container. The history comes from the database and is replayed in the prompt
// (concierge-prompt.ts). Like `task-classify.ts` and `models-probe.ts`, `query` and
// `credentialEnvFor` are injected, never the real SDK in tests.
//
// It has had tools since 13/09. It had none, and the only real question it was ever asked hit
// that wall ("the technical details of why they failed are not in my context"). The reasoning is
// in `docs/wiki/produit/decisions.md`.
//
// Refusal is still the default; three named doors were opened:
//   1. `tools: []`: the SDK tool base stays empty. No `Bash`, no `Write`, no disk reads, only
//      three control plane reads.
//   2. `allowedTools` holds only `CONCIERGE_TOOL_NAMES`, `disallowedTools` still names the whole
//      catalogue, and `settingSources: []` keeps a repository `.claude/settings.json` from adding
//      one.
//   3. `canUseTool` refuses and interrupts anything outside the list: the net for an SDK bridge
//      bug or a change that would grant an implicit tool.
//
// Write tools (create a task, answer the inbox, cancel a session) are not granted: they need a
// confirmation in the thread, and `POST /api/concierge` is a single round trip that cannot pause
// midway.
import { createSdkMcpServer, query, tool, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { credentialEnvFor } from "../projects/auth.js";
import { LEGION_MCP_TOOLS, BASE_SDK_TOOLS } from "../capabilities/tool-grants.js";
import {
  buildConciergePrompt,
  CONCIERGE_SYSTEM_PROMPT,
  type ConciergeInput,
} from "./concierge-prompt.js";
import {
  buildConciergeTools,
  CONCIERGE_TOOL_NAMES,
  CONCIERGE_TOOL_TURNS,
  type ConciergeToolsStore,
} from "./concierge-tools.js";
import * as toolsStore from "./concierge-tools-store.js";
import type { ConciergeContextData } from "./concierge-context.js";

export type { ConciergeInput, ConciergeTurn } from "./concierge-prompt.js";

export type ConciergeResult =
  | { ok: true; reply: string }
  | { ok: false; status: 502 | 504; error: string };

export interface ConciergeDeps {
  query: typeof query;
  credentialEnvFor: (projectId?: string) => { env: Record<string, string | undefined> };
  timeoutMs: number;
  model: string;
  /** The queries the tools call, injectable so `concierge.test.ts` exercises the wiring without a
   *  database. */
  toolsStore: ConciergeToolsStore;
}

export const defaultConciergeDeps: ConciergeDeps = {
  query,
  credentialEnvFor,
  // 60 s, not 15: a tooled investigation makes several round trips (find the task, read its
  // detail, read its trace, conclude). The timeout bounds the whole session, not each turn.
  timeoutMs: 60_000,
  model: "haiku",
  toolsStore,
};

/** Every tool the app catalogue names (capabilities/tool-grants.ts). The concierge needs none of
 *  them: its own tools are defined in `concierge-tools.ts`. Naming them on top of `tools: []` is a
 *  second belt, should `tools` ever be misconfigured. */
export const CONCIERGE_DISALLOWED_TOOLS: readonly string[] = [
  ...BASE_SDK_TOOLS,
  ...LEGION_MCP_TOOLS,
];

/** The net for the tool-less path (the situation report): refuse everything and interrupt.
 *  Exported so the test calls it as the SDK session would. */
export const denyAllTools: CanUseTool = async (toolName) => ({
  behavior: "deny",
  message: `the concierge is read-only: tool "${toolName}" is refused`,
  interrupt: true,
});

/** The same net with an allow-list. Anything else is refused and interrupts: an unlisted tool
 *  means the session is not the one we opened. `input` passes through unchanged: this guard
 *  decides which tool, not with what. */
export function allowOnly(names: readonly string[]): CanUseTool {
  const allowed = new Set(names);
  return async (toolName, input) =>
    allowed.has(toolName)
      ? { behavior: "allow", updatedInput: input }
      : {
          behavior: "deny",
          message: `the concierge was not given tool "${toolName}"`,
          interrupt: true,
        };
}

type ResultMessage = { type: string; subtype?: string; result?: string };

async function collectReply(q: AsyncIterable<ResultMessage>): Promise<string> {
  for await (const msg of q) {
    if (msg.type !== "result") continue;
    if (msg.subtype === "success" && typeof msg.result === "string" && msg.result.trim())
      return msg.result;
    throw new Error(`the concierge produced no usable answer (${msg.subtype ?? "unknown"})`);
  }
  throw new Error("no answer from the concierge");
}

export async function askConcierge(
  input: ConciergeInput,
  context: ConciergeContextData,
  deps?: ConciergeDeps,
): Promise<ConciergeResult> {
  return runConciergeQuery(buildConciergePrompt(input, context), CONCIERGE_SYSTEM_PROMPT, deps, {
    tooled: true,
  });
}

/** The only place a concierge session opens, hence the only place the belts are set (extracted
 *  in slice nav/10 when the situation report became a second caller).
 *
 *  The caller picks the prompt, the system prompt, and whether it is tooled: a boolean, never a
 *  tool list, so the situation report cannot gain a tool by oversight. */
export async function runConciergeQuery(
  prompt: string,
  systemPrompt: string,
  deps: ConciergeDeps = defaultConciergeDeps,
  opts: { tooled?: boolean } = {},
): Promise<ConciergeResult> {
  const tooled = opts.tooled === true;
  const { env } = deps.credentialEnvFor(); // control plane: the concierge reads every project and belongs to none
  const q = deps.query({
    prompt,
    options: {
      model: deps.model,
      // Without tools there is nothing to loop on; with them, room for an investigation.
      maxTurns: tooled ? CONCIERGE_TOOL_TURNS : 1,
      tools: [],
      allowedTools: tooled ? [...CONCIERGE_TOOL_NAMES] : [],
      disallowedTools: [...CONCIERGE_DISALLOWED_TOOLS],
      settingSources: [],
      ...(tooled
        ? {
            mcpServers: {
              legion: createSdkMcpServer({
                name: "legion",
                tools: buildConciergeTools({ tool }, deps.toolsStore),
              }),
            },
          }
        : {}),
      canUseTool: tooled ? allowOnly(CONCIERGE_TOOL_NAMES) : denyAllTools,
      systemPrompt,
      env,
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out (${deps.timeoutMs / 1000} s)`)),
      deps.timeoutMs,
    );
  });

  try {
    const reply = await Promise.race([collectReply(q), timeout]);
    return { ok: true, reply };
  } catch (err) {
    const message = (err as Error).message || "concierge failure";
    const status = message.startsWith("timed out") ? 504 : 502;
    return { ok: false, status, error: `the concierge could not answer (${message})` };
  } finally {
    clearTimeout(timer);
    await (q as { interrupt?: () => Promise<unknown> }).interrupt?.().catch(() => {});
  }
}
