// What a session stream ESTABLISHES: the facts the verdict turns into sentences (which tool still
// runs, what was really pushed, why the session stopped). Pulled out of `TaskPage.tsx`, where they
// were inlined and only checkable by mounting the page. None touches React.
import { type Session } from "../api/sessions.js";
import { type TimelineEvent } from "./trace-text.js";

export const SEC = 1000;
const MIN = 60_000,
  HOUR = 3_600_000;

/** A duration read at a glance: seconds, then minutes, then hours and minutes. Never negative: a
 *  clock going backwards (Mac sleep, server skew) would show "-3 s" next to a "since". */
export function elapsed(ms: number): string {
  if (ms < MIN) return `${Math.max(0, Math.floor(ms / SEC))} s`;
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min`;
  return `${Math.floor(ms / HOUR)} h ${String(Math.floor((ms % HOUR) / MIN)).padStart(2, "0")}`;
}

/** The tool STILL running: a `tool_start` not closed by its `tool_end`. `null` when the agent thinks
 *  without a tool: not a failure, the other half of the work. */
export function pendingTool(events: TimelineEvent[]): TimelineEvent | null {
  let pending: TimelineEvent | null = null;
  for (const ev of events) {
    if (ev.type === "tool_start") pending = ev;
    else if (ev.type === "tool_end") pending = null;
  }
  return pending;
}

/** Where the "currently" line counts from: the start of the running tool, else the session start. */
export function pendingSince(
  pending: TimelineEvent | null,
  session: Pick<Session, "startedAt">,
): number {
  return typeof pending?.data.ts === "number" ? pending.data.ts : Date.parse(session.startedAt);
}

export type RepoPush = { repo: string; changes: number; commit: string };

/** What was ACTUALLY pushed, one repo per line. A repo's last push overwrites the previous one (same
 *  work pushed twice), and a zero-change push is not a fact to announce: nothing happened on that
 *  branch. */
export function pushedRepos(events: TimelineEvent[]): RepoPush[] {
  const pushes = new Map<string, RepoPush>();
  for (const ev of events) {
    if (ev.type !== "repo_push") continue;
    const changes = typeof ev.data.changes === "number" ? ev.data.changes : 0;
    const repo = String(ev.data.repo ?? "");
    if (changes > 0) pushes.set(repo, { repo, changes, commit: String(ev.data.commit ?? "") });
  }
  return [...pushes.values()];
}

/** ONE RUN is one SDK `query()`: the first start, then each resume. The SDK bills each separately,
 *  so a resumed session counts several (measured 10/09: three runs at $0.94 / $0 / $3.40 on one
 *  session). */
export type SessionRun = {
  /** Rank within the session, 1 for the first start. */
  index: number;
  costUsd: number;
  numTurns: number | null;
  /** The run's OWN duration, published by the runtime since 10/09 (SDK `duration_ms`). `null` on
   *  older traces, where the only known duration was the session wall clock, resumes and waits
   *  included. */
  durationMs: number | null;
  /** Time spent waiting on the model (`duration_api_ms`). The rest of `durationMs` is tool
   *  execution. */
  durationApiMs: number | null;
  failed: boolean;
};

/** A session's runs, in order. One `result` per run, the only place the detail exists: the session
 *  ROW only carries the sum. */
export function runsOf(events: TimelineEvent[]): SessionRun[] {
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return events
    .filter((e) => e.type === "result")
    .map((e, i) => ({
      index: i + 1,
      costUsd: num(e.data.costUsd) ?? 0,
      numTurns: num(e.data.numTurns),
      durationMs: num(e.data.durationMs),
      durationApiMs: num(e.data.durationApiMs),
      // `subtype` can lie, `isError` cannot (runner-payload/turn-outcome.mts).
      failed: e.data.isError === true || e.data.subtype !== "success",
    }));
}

/** A session's WORK TIME: the sum of its runs. Read next to the wall clock (`endedAt - startedAt`),
 *  not instead of it: the gap IS the waiting (an inbox question, a queue, a quota). Eleven hours of
 *  wall clock for twenty minutes of work is a fact about the organisation, not the agent.
 *
 *  `null` when no run carries its duration (traces before 10/09): showing zero would suggest the
 *  session worked instantly. */
export function workMs(runs: SessionRun[], part: "total" | "api" = "total"): number | null {
  const known = runs
    .map((r) => (part === "api" ? r.durationApiMs : r.durationMs))
    .filter((ms): ms is number => ms !== null);
  return known.length === 0 ? null : known.reduce((sum, ms) => sum + ms, 0);
}

export type SessionOutcome = {
  succeeded: boolean;
  numTurns: number | null;
  /** Why the session closed. The column (v22) first; for older sessions the `status` event published
   *  by `markSessionTerminal` carries the same information. */
  endReason: string | null;
  /** The last `run_error`, which refines the cause when the manager said nothing. */
  runError: TimelineEvent | null;
};

export function sessionOutcome(
  session: Pick<Session, "endReason">,
  events: TimelineEvent[],
): SessionOutcome {
  const reversed = [...events].reverse();
  const lastResult = reversed.find((e) => e.type === "result");
  const lastReason = reversed.find((e) => e.type === "status" && typeof e.data.reason === "string");
  return {
    succeeded: lastResult?.data.subtype === "success",
    numTurns: typeof lastResult?.data.numTurns === "number" ? lastResult.data.numTurns : null,
    endReason: session.endReason ?? (lastReason ? String(lastReason.data.reason) : null),
    runError: reversed.find((e) => e.type === "run_error") ?? null,
  };
}
