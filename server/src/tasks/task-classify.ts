// Simplified composer (operator decision 23/08): the human writes title + brief and only picks
// now/later; the rest (agent or chain, complexity, gate) is proposed by an SDK control call on haiku,
// not decided for them. Same spirit as the model probe (models/models-probe.ts): inform, never
// block. Same call pattern as `concierge.ts`: `query()` as control, maxTurns 1, no container, the
// project's credentials.
//
// Mandatory fallback (spec): empty name, no agent and no chain to propose, out-of-schema answer,
// hallucinated name matching nothing known, failure, or exceeding a short timeout (~3 s) all return
// the composer's current defaults (the project's first agent, complexity "med", gate off) with
// reason="repli". This route must never make a task creation fail: it only suggests.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { credentialEnvFor } from "../projects/auth.js";
import { BRANCH_TYPE, BRANCH_TYPES, DEFAULT_BRANCH_TYPE, type BranchType } from "./task-branch.js";
import { COMPLEXITY } from "./task-scales.js";

export type Level = "low" | "med" | "high";

export interface ClassifyAgent {
  id: string;
  name: string;
  title: string;
  rolePrompt: string;
}

export interface ClassifyChain {
  id: string;
  name: string;
  description: string;
}

export interface ClassifyInput {
  projectId?: string;
  name: string;
  description: string;
  agents: ClassifyAgent[];
  chains: ClassifyChain[];
  /** Operator pins (23/08, operator feedback): a field chosen by hand is a constraint given to the
   *  classifier, not a silence; it keeps proposing the others around it. A pin is never overwritten
   *  by the model's answer, whatever it says. */
  forced?: {
    agentId?: string | null;
    templateId?: string | null;
    complexity?: Level | null;
    gate?: boolean | null;
  };
}

export interface ClassifyResult {
  kind: "agent" | "chain";
  /** Id of an agent of the project (`schema.agents.id`), set when kind === "agent". */
  agentId: string | null;
  /** Id of a catalogue chain (`listChainLibrary()`, built-in or promoted), set when kind === "chain".
   *  A proposed chain is not necessarily installed in the project yet; the human gesture installs it
   *  before running it, as today. */
  templateId: string | null;
  complexity: Level;
  gate: boolean;
  /** v50: the work type in the conventionalbranch.org sense, naming the branch (`task-branch.ts`). It
   *  falls into the same fallback as the other fields: out-of-schema answer, failure, timeout all
   *  return `chore`. A doc fix sent as `feature/` would lie more than an overcautious `chore/`, and
   *  nothing here may make a creation fail. */
  type: BranchType;
  reason: string;
}

/** Injectable dependencies: the only way to test `classifyTask` without the real SDK, network or
 *  clock (same spirit as `ProbeDeps` in models/models-probe.ts). */
export interface ClassifyDeps {
  query: typeof query;
  credentialEnvFor: (projectId?: string) => { env: Record<string, string | undefined> };
  timeoutMs: number;
}

const defaultDeps: ClassifyDeps = { query, credentialEnvFor, timeoutMs: 3000 };

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["agent", "chain"] },
    // The exact name as listed in the prompt, never an id: sturdier than an opaque string the model
    // could truncate or invent, and checkable afterwards.
    name: { type: "string" },
    complexity: { type: "string", enum: ["low", "med", "high"] },
    gate: { type: "boolean" },
    type: { type: "string", enum: [...BRANCH_TYPES] },
    reason: { type: "string" },
  },
  required: ["kind", "name", "complexity", "gate", "type", "reason"],
  additionalProperties: false,
};

type StructuredOutput = {
  kind: "agent" | "chain";
  name: string;
  complexity: Level;
  gate: boolean;
  type: BranchType;
  reason: string;
};

const LEVELS: readonly Level[] = ["low", "med", "high"];

function isStructuredOutput(v: unknown): v is StructuredOutput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.kind === "agent" || o.kind === "chain") &&
    typeof o.name === "string" &&
    o.name.trim().length > 0 &&
    typeof o.complexity === "string" &&
    LEVELS.includes(o.complexity as Level) &&
    typeof o.gate === "boolean" &&
    typeof o.type === "string" &&
    (BRANCH_TYPES as readonly string[]).includes(o.type) &&
    typeof o.reason === "string"
  );
}

/** The composer's current defaults (`TaskComposer.tsx`: `agents[0]?.id`, complexity "med", gate
 *  off): the fallback must invent nothing the screen did not already offer before this route. The
 *  operator's pins survive the fallback: a classify failure does not take control back. */
function fallback(input: ClassifyInput, reason: string): ClassifyResult {
  return applyPins(input, {
    kind: "agent",
    agentId: input.agents[0]?.id ?? null,
    templateId: null,
    complexity: COMPLEXITY.med,
    gate: false,
    type: DEFAULT_BRANCH_TYPE,
    reason,
  });
}

/** The operator's validated pins: an id that does not exist (agent deleted between two keystrokes) is
 *  ignored rather than propagated; we do not pin a ghost. */
function validPins(input: ClassifyInput) {
  const f = input.forced ?? {};
  const agentId = f.agentId && input.agents.some((a) => a.id === f.agentId) ? f.agentId : null;
  const templateId =
    f.templateId && input.chains.some((c) => c.id === f.templateId) ? f.templateId : null;
  const complexity =
    f.complexity && (LEVELS as readonly string[]).includes(f.complexity) ? f.complexity : null;
  const gate = typeof f.gate === "boolean" ? f.gate : null;
  return { agentId, templateId, complexity, gate, target: Boolean(agentId || templateId) };
}

/** Applies pins on top of a result (the model's or the fallback's): the hand wins field by field,
 *  the rest comes from the proposal. */
function applyPins(input: ClassifyInput, result: ClassifyResult): ClassifyResult {
  const pins = validPins(input);
  let out = result;
  if (pins.templateId) out = { ...out, kind: "chain", agentId: null, templateId: pins.templateId };
  else if (pins.agentId) out = { ...out, kind: "agent", agentId: pins.agentId, templateId: null };
  if (pins.complexity) out = { ...out, complexity: pins.complexity };
  if (pins.gate !== null) out = { ...out, gate: pins.gate };
  return out;
}

function prompt(input: ClassifyInput): string {
  const agentsBlock =
    input.agents.length > 0
      ? input.agents
          .map((a) => `- ${a.name} (${a.title}): ${a.rolePrompt.slice(0, 500)}`)
          .join("\n")
      : "(no agent in this project)";
  const chainsBlock =
    input.chains.length > 0
      ? input.chains.map((c) => `- ${c.name}: ${c.description.slice(0, 500)}`).join("\n")
      : "(no chain in the catalog)";
  const pins = validPins(input);
  const pinLines: string[] = [];
  if (pins.agentId)
    pinLines.push(
      `- assignee: agent "${input.agents.find((a) => a.id === pins.agentId)?.name}" (echo it as kind/name — do NOT change it)`,
    );
  if (pins.templateId)
    pinLines.push(
      `- assignee: chain "${input.chains.find((c) => c.id === pins.templateId)?.name}" (echo it as kind/name — do NOT change it)`,
    );
  if (pins.complexity)
    pinLines.push(`- complexity: "${pins.complexity}" (echo it — do NOT change it)`);
  if (pins.gate !== null) pinLines.push(`- gate: ${pins.gate} (echo it — do NOT change it)`);
  const pinsBlock =
    pinLines.length > 0
      ? `\nThe operator has ALREADY PINNED these settings by hand — they are constraints, not suggestions. Propose the remaining fields AROUND them, and let your reason explain the fields you actually chose:\n${pinLines.join("\n")}\n`
      : "";
  return (
    `A human is creating a task in Legion. Propose the best assignee and settings — you inform, ` +
    `you never decide for them.\n\n` +
    `Task title: ${input.name}\n` +
    `Task brief: ${input.description.trim() || "(empty)"}\n\n` +
    `Agents available in this project (pick one BY NAME for a single-shot task):\n${agentsBlock}\n\n` +
    `Chains available in the catalog (pick one BY NAME when the task needs several distinct ` +
    `steps or a review pass — e.g. spec → plan → implement → review):\n${chainsBlock}\n` +
    pinsBlock +
    `\n` +
    `Reply with: kind ("agent" or "chain"), name (EXACT name copied from the list above, nothing ` +
    `else), complexity ("low"=small touch-up/haiku routing, "med"=normal work, ` +
    `"high"=hard decision/opus routing), gate (true if a human should approve the result ` +
    `before it counts as done), type (conventionalbranch.org — "${BRANCH_TYPE.feature}" for new behaviour, ` +
    `"${BRANCH_TYPE.bugfix}" for something broken that must work again, "${BRANCH_TYPE.chore}" for anything else: docs, ` +
    `refactor, config, chores; when in doubt say "${BRANCH_TYPE.chore}"), and reason (ONE short sentence, in ` +
    `English, explaining the pick).`
  );
}

async function collectStructuredOutput(
  q: AsyncIterable<{ type: string; subtype?: string; structured_output?: unknown }>,
): Promise<unknown> {
  for await (const msg of q)
    if (msg.type === "result" && msg.subtype === "success" && msg.structured_output !== undefined)
      return msg.structured_output;
  throw new Error("no structured output");
}

export async function classifyTask(
  input: ClassifyInput,
  deps: ClassifyDeps = defaultDeps,
): Promise<ClassifyResult> {
  if (!input.name.trim()) return fallback(input, "repli");
  if (input.agents.length === 0 && input.chains.length === 0) return fallback(input, "repli");
  const pins = validPins(input);
  // Everything is pinned (a pinned chain has neither complexity nor gate): nothing to propose, no
  // model round trip; the answer is the operator's configuration, stated as such.
  if (pins.templateId || (pins.target && pins.complexity && pins.gate !== null))
    return applyPins(input, {
      kind: "agent",
      agentId: null,
      templateId: null,
      complexity: COMPLEXITY.med,
      gate: false,
      // The type is not pinnable: no screen offers it, it only names the branch. Setting everything
      // by hand therefore returns `chore`, like the fallback.
      type: DEFAULT_BRANCH_TYPE,
      reason: "set by hand",
    });

  const { env } = deps.credentialEnvFor(input.projectId);
  const q = deps.query({
    prompt: prompt(input),
    options: {
      model: "haiku",
      maxTurns: 1,
      tools: [],
      allowedTools: [],
      settingSources: [],
      systemPrompt: "You classify Legion task creation requests. Structured output only, no prose.",
      outputFormat: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> },
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
    const out = await Promise.race([collectStructuredOutput(q), timeout]);
    if (!isStructuredOutput(out)) return fallback(input, "repli");
    if (out.kind === "agent") {
      const agent = input.agents.find((a) => a.name === out.name);
      if (!agent) return fallback(input, "repli"); // hallucinated name: we do not guess which
      // Pins win over the answer: even if the model "forgets" a constraint, it cannot be
      // overwritten. The requested echo is not a contract.
      return applyPins(input, {
        kind: "agent",
        agentId: agent.id,
        templateId: null,
        complexity: out.complexity,
        gate: out.gate,
        type: out.type,
        reason: out.reason,
      });
    }
    const chainMatch = input.chains.find((ch) => ch.name === out.name);
    if (!chainMatch) return fallback(input, "repli");
    return applyPins(input, {
      kind: "chain",
      agentId: null,
      templateId: chainMatch.id,
      complexity: out.complexity,
      gate: out.gate,
      type: out.type,
      reason: out.reason,
    });
  } catch {
    // Failure, out-of-schema answer, or timeout: never an exception climbing up to block task
    // creation (spec: "the composer must never block").
    return fallback(input, "repli");
  } finally {
    clearTimeout(timer);
    await (q as { interrupt?: () => Promise<unknown> }).interrupt?.().catch(() => {});
  }
}
