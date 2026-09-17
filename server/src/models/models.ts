// Available models and their capabilities, asked of the SDK, never hard-coded.
//
// 20/08: the Agents page offered three hand-written `<option>`s, two of which no longer existed. A
// hard-coded list goes stale silently at every model release. `supportedModels()` is the source,
// and it also returns effort and adaptive-thinking capabilities, so the screen does not offer an
// effort setting the model ignores.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../shared/log.js";

const log = createLogger("models");

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const THINKING_MODES = ["adaptive", "enabled", "disabled"] as const;

export interface ModelChoice {
  /** The id to send. May be an alias (`opus`, `sonnet`), which survives the next model release. */
  id: string;
  /** The real id behind an alias, when the SDK gives it, so the operator knows what actually runs. */
  resolves: string | null;
  displayName: string;
  description: string;
  supportsEffort: boolean;
  effortLevels: EffortLevel[];
  supportsAdaptiveThinking: boolean;
}

/** Used when the SDK is unreachable (no credential, offline, CLI missing). Aliases on purpose: they
 *  stay right after the next release. The API flags it as a fallback and the screen must say so,
 *  or it passes for the real list. */
const FALLBACK: ModelChoice[] = [
  {
    id: "opus",
    resolves: null,
    displayName: "Opus (alias)",
    description: "The most capable. Alias: follows the current version automatically.",
    supportsEffort: true,
    effortLevels: [...EFFORT_LEVELS],
    supportsAdaptiveThinking: true,
  },
  {
    id: "sonnet",
    resolves: null,
    displayName: "Sonnet (alias)",
    description: "Balances capability and cost. Alias: follows the current version automatically.",
    supportsEffort: true,
    effortLevels: [...EFFORT_LEVELS],
    supportsAdaptiveThinking: true,
  },
  {
    id: "haiku",
    resolves: null,
    displayName: "Haiku (alias)",
    description: "The fastest and cheapest. Alias: follows the current version automatically.",
    supportsEffort: false,
    effortLevels: [],
    supportsAdaptiveThinking: false,
  },
];

/** Minimal shape of `ModelInfo` (SDK 0.3.234): only what we read. */
type SdkModelInfo = {
  value: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
};

/** Capability fields are optional in the SDK: an `undefined` read as `true` would offer an effort
 *  setting where none exists. */
export function toChoice(row: SdkModelInfo): ModelChoice {
  const levels = (row.supportedEffortLevels ?? []).filter((l): l is EffortLevel =>
    (EFFORT_LEVELS as readonly string[]).includes(l),
  );
  return {
    id: row.value,
    resolves: row.resolvedModel && row.resolvedModel !== row.value ? row.resolvedModel : null,
    displayName: row.displayName?.trim() || row.value,
    description: row.description?.trim() || "",
    // `supportsEffort` can be true without levels (full scale then), and levels without the flag
    // mean it works too.
    supportsEffort: row.supportsEffort === true || levels.length > 0,
    effortLevels:
      levels.length > 0 ? levels : row.supportsEffort === true ? [...EFFORT_LEVELS] : [],
    supportsAdaptiveThinking: row.supportsAdaptiveThinking === true,
  };
}

/** Checked by the API before saving: accepting an effort the model ignores shows a setting that
 *  does nothing. */
export function effortAllowed(
  models: readonly ModelChoice[],
  modelId: string,
  effort: string,
): boolean {
  const m = models.find((x) => x.id === modelId);
  if (!m) return true; // unknown to the SDK (pinned by hand): do not block the operator
  return m.supportsEffort && m.effortLevels.includes(effort as EffortLevel);
}

const TTL_MS = 6 * 60 * 60 * 1000; // the list moves over weeks, not minutes
let cache: { at: number; models: ModelChoice[]; source: "sdk" | "fallback" } | null = null;

/** Opens a minimal query only to reach the `supportedModels()` control method, then interrupts
 *  it: no model turn is consumed. */
async function fromSdk(): Promise<ModelChoice[]> {
  const q = query({
    prompt: "",
    options: { maxTurns: 1, tools: [], allowedTools: [], settingSources: [] },
  });
  try {
    const rows = (await q.supportedModels()) as SdkModelInfo[];
    return rows.filter((r) => typeof r?.value === "string" && r.value).map(toChoice);
  } finally {
    // `interrupt` may not exist depending on the query state; a failed cleanup must never hide a
    // list we obtained.
    await (q as { interrupt?: () => Promise<void> }).interrupt?.().catch(() => {});
  }
}

export async function listModels(opts: { refresh?: boolean } = {}): Promise<{
  models: ModelChoice[];
  source: "sdk" | "fallback";
  fetchedAt: number;
}> {
  if (!opts.refresh && cache && Date.now() - cache.at < TTL_MS)
    return { models: cache.models, source: cache.source, fetchedAt: cache.at };
  let models: ModelChoice[] = [];
  let source: "sdk" | "fallback" = "sdk";
  try {
    models = await fromSdk();
  } catch (err) {
    log.warn("list unavailable, falling back to aliases", { error: (err as Error).message });
  }
  if (models.length === 0) {
    models = FALLBACK;
    source = "fallback";
  }
  cache = { at: Date.now(), models, source };
  return { models, source, fetchedAt: cache.at };
}

/** For tests and hot restart. */
export function clearModelCache(): void {
  cache = null;
}
