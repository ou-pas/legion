// The situation report: what one reads before asking anything. It is the first turn of the
// conversation, not a banner above it (docs/directions/direction-concierge.html).
//
// Computed on demand, never on a timer: this file has no scheduling `setInterval` or
// `setTimeout`, and `concierge-brief.test.ts` lets a simulated day pass without a single model
// call. On 30/08 a morning went into fixing a gauge killed by an endpoint that counted our calls;
// a clock that spends while we sleep is the same mistake.
//
// Besides prose it returns a triage of what is waiting (`now` / `soon` / `fyi`). The triage does
// the work; without it this would be the inbox in another font.
//
// Links do not come from the model: it can only copy task ids from the server-compiled context,
// and `parseBrief` drops any id not in that list. The brief session runs without tools.
import { runConciergeQuery, type ConciergeDeps } from "./concierge.js";
import { formatConciergeContext } from "./concierge-prompt.js";
import { fetchConciergeContext, type ConciergeContextData } from "./concierge-context.js";

/** `now`: what comes next depends on it now. `soon`: it is going to get stuck. `fyi`: worth
 *  knowing, nothing to do. Three levels, not five: beyond that nobody knows what the third means. */
export type BriefSeverity = "now" | "soon" | "fyi";

export interface BriefItem {
  severity: BriefSeverity;
  /** One sentence. Inline Markdown (bold, code) is allowed. */
  text: string;
  /** The cited task, checked against the compiled context, or `null`. The screen builds its link
   *  from this field, never from a URL written by the model. */
  taskId: string | null;
  /** The task's project (nav/B); without it the screen can only build the short redirecting URL.
   *  `null` if `taskId` is, or if the compiled context did not carry it. */
  projectId: string | null;
}

/** Why there is (or is not) something to read:
 *   - "computed"         the model answered.
 *   - "nothing-to-tell"  the control plane is empty (first launch): no call was made. The screen
 *                        says why and what to do instead of a blank page.
 *   - "error"            the call failed; `error` carries the sentence. */
export type BriefReason = "computed" | "nothing-to-tell" | "error";

export interface ConciergeBrief {
  reason: BriefReason;
  prose: string[];
  items: BriefItem[];
  /** How many projects moved: a report without its scope does not say whether it looked
   *  everywhere. */
  projectCount: number;
  /** A figure without its age gets wrongly believed. */
  generatedAt: number;
  error: string | null;
}

export const BRIEF_SYSTEM_PROMPT =
  "You are the Legion concierge. You write the SITUATION REPORT the operator reads on arrival, " +
  "before asking any question. You are READ-ONLY: you were given no tool and cannot change any " +
  "task, session or setting. " +
  'Write SENTENCES, not counters: "3 sessions" gets read and filed away, "slice 09 has been ' +
  'stopped for 40 minutes on an approval nobody has seen" says what to do about it. ' +
  "Invent nothing: if the context does not carry the information, do not write it. " +
  // Same clause as `CONCIERGE_SYSTEM_PROMPT`: the design contract forbids emoji
  // (docs/DESIGN.md, rule 8).
  "Never write emoji or pictograms: your text is displayed in an interface that uses none.";

/** The output format, spelled out. `parseBrief` can discard prose around the JSON, but better not
 *  to produce it. */
const OUTPUT_CONTRACT =
  "## What you answer\n" +
  "ONLY a JSON object, with no text around it and no code block, of this shape:\n" +
  '{ "prose": ["…", "…"], "items": [{ "severity": "now|soon|fyi", "text": "…", "task": "<id or null>" }] }\n\n' +
  "- `prose`: one to three short paragraphs. What changed, what is running, what it costs.\n" +
  "- `items`: what is WAITING for a decision, most urgent first. `now` = what comes next depends " +
  "on it now, `soon` = it is going to get stuck, `fyi` = worth knowing, nothing to do. Three to " +
  "six entries, and an empty list if nothing is waiting — do not invent urgency.\n" +
  "- `task`: the `task=…` id of the context line you are talking about, copied as is, or " +
  "`null`. Never invent an id: an id absent from the context is removed.";

export function buildBriefPrompt(context: ConciergeContextData): string {
  return `${formatConciergeContext(context)}\n\n${OUTPUT_CONTRACT}`;
}

/** On first launch the control plane is empty: paying a model to say "nothing ran" would buy
 *  information we already have. */
export function hasSomethingToTell(context: ConciergeContextData): boolean {
  return (
    context.tasks.length > 0 || context.sessions.length > 0 || context.pendingQuestions.length > 0
  );
}

const SEVERITIES = new Set<string>(["now", "soon", "fyi"]);
const TEXT_MAX = 400;

/** Model JSON sometimes comes wrapped in ```json … ``` or after a sentence. First brace to last
 *  covers both without a parser. */
function jsonSlice(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start === -1 || end <= start ? null : raw.slice(start, end + 1);
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, TEXT_MAX) : null;
};

/** Pure: no clock, no network, no database.
 *
 *  `known` holds the ids the server put in the context. Anything else the model cites becomes
 *  `taskId: null`: the sentence stays (it may be right), the link goes.
 *
 *  An unparseable answer is not discarded: the raw prose is returned without items. A poorly
 *  sorted page beats an empty one. */
export function parseBrief(
  raw: string,
  known: ReadonlyMap<string, string | null>,
): { prose: string[]; items: BriefItem[] } {
  const slice = jsonSlice(raw);
  let parsed: unknown = null;
  if (slice) {
    try {
      parsed = JSON.parse(slice);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object") return { prose: fallbackProse(raw), items: [] };

  const o = parsed as { prose?: unknown; items?: unknown };
  const prose = Array.isArray(o.prose)
    ? o.prose.map(clean).filter((p): p is string => p !== null)
    : [];
  const items = (Array.isArray(o.items) ? o.items : []).flatMap((entry): BriefItem[] => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as { severity?: unknown; text?: unknown; task?: unknown };
    const text = clean(e.text);
    if (!text) return [];
    const severity =
      typeof e.severity === "string" && SEVERITIES.has(e.severity)
        ? (e.severity as BriefSeverity)
        : // An unknown level does not drop the line: it falls to `fyi`, which asks nothing of
          // anyone.
          "fyi";
    const cited = typeof e.task === "string" ? e.task.replace(/^task=/, "") : "";
    const verified = known.has(cited);
    return [
      {
        severity,
        text,
        taskId: verified ? cited : null,
        projectId: verified ? (known.get(cited) ?? null) : null,
      },
    ];
  });

  return { prose: prose.length > 0 ? prose : fallbackProse(raw), items };
}

/** Shown when no JSON came: the model's text, split into paragraphs. */
function fallbackProse(raw: string): string[] {
  return raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((p) => p.slice(0, TEXT_MAX * 4));
}

// Cache: one entry, since there is one concierge spanning every project.
//
// Ten minutes: what it describes moves at the scale of a work session, and each refresh is a
// model call. The age is returned, so the operator sees the report is six minutes old and can
// refresh; with no global event stream, freshness is paid for with a visible timestamp.
const TTL_MS = 600_000;

let cache: { at: number; value: ConciergeBrief } | null = null;

/** Tests only: the cache lives in the module, so two suites sharing it would contaminate each
 *  other. */
export function clearConciergeBriefCache(): void {
  cache = null;
}

export interface BriefDeps {
  /** Injected, as everywhere in this domain: never the real SDK in a test. */
  run: typeof runConciergeQuery;
  context: typeof fetchConciergeContext;
  conciergeDeps?: ConciergeDeps;
  now: () => number;
}

/** The situation report, computed on demand. `refresh` (the timestamp link) recomputes it: the
 *  only way to spend a call is to ask for one. */
export async function conciergeBrief(
  opts: { refresh?: boolean } = {},
  deps: Partial<BriefDeps> = {},
): Promise<ConciergeBrief> {
  const run = deps.run ?? runConciergeQuery;
  const context = deps.context ?? fetchConciergeContext;
  const now = deps.now ? deps.now() : Date.now();

  if (!opts.refresh && cache && now - cache.at < TTL_MS) return cache.value;

  const data = context();
  const projectCount = new Set(data.tasks.map((t) => t.projectName)).size;

  if (!hasSomethingToTell(data)) {
    // No call. Cached anyway, or every visit to a fresh install would rescan the database.
    return remember(now, {
      reason: "nothing-to-tell",
      prose: [],
      items: [],
      projectCount,
      generatedAt: now,
      error: null,
    });
  }

  const result = await run(buildBriefPrompt(data), BRIEF_SYSTEM_PROMPT, deps.conciergeDeps);
  if (!result.ok) {
    // A failure keeps the last known report: a ten-minute-old report with its age beats nothing.
    if (cache) return remember(now, { ...cache.value, error: result.error });
    return remember(now, {
      reason: "error",
      prose: [],
      items: [],
      projectCount,
      generatedAt: now,
      error: result.error,
    });
  }

  const known = new Map<string, string | null>([
    ...data.tasks.map((t): [string, string | null] => [t.id, t.projectId]),
    ...data.pendingQuestions.map((q): [string, string | null] => [q.taskId, q.projectId]),
  ]);
  const { prose, items } = parseBrief(result.reply, known);
  return remember(now, {
    reason: "computed",
    prose,
    items,
    projectCount,
    generatedAt: now,
    error: null,
  });
}

function remember(at: number, value: ConciergeBrief): ConciergeBrief {
  cache = { at, value };
  return value;
}
