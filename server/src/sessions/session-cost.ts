// The cost of a run, a session, a task: three numbers that used to be confused.
//
// Moved out of `internal-routes.ts` (lot 11). Nothing here touches the database: the route reads
// rows, this module counts.
//
// Obs 4 (23/08): the TASK's cumulative cost is computed BEFORE publishing so it lands in the end
// event itself. That prepares a future DOLLAR guardrail across sessions (the same path as
// `goals.spentUsd`/`budgetUsd`) without setting one today, and whoever reads the event later has
// nothing to recompute.

/** `null` if the event carries none.
 *
 *  The SDK bills each `query()` separately: measured on 10/09 on session `RPXUHq0upSK-`, three runs
 *  at $0.94, then $0, then $3.40, with `numTurns` that do not add up either (2, 1, 44).
 *  `total_cost_usd` is therefore the cost OF THE RUN, not of the resumed conversation. */
export function runCostOf(type: string, payload: unknown): number | null {
  if (type !== "result") return null;
  const cost = (payload as { costUsd?: number } | null)?.costUsd;
  return typeof cost === "number" ? cost : null;
}

/** The SESSION's cost: the sum of its runs.
 *
 *  A `set()` of only the last run overwrote the previous ones, and a resumed session's row only told
 *  its last resume ($3.40 instead of $4.35 in the example above). The per-run detail stays in the
 *  trace; the TOTAL was missing. */
export function sessionCostAfter(alreadySpent: number | null, runCost: number): number {
  return (alreadySpent ?? 0) + runCost;
}

/** The TASK's cumulative cost across sessions, the one that just wrote counted at its NEW value,
 *  not yet in the database. Rounded to a tenth of a cent: an amount read by a human, not a sum to
 *  reconcile. */
export function taskCostAfter(
  sessions: readonly { id: string; costUsd: number | null }[],
  sessionId: string,
  sessionCost: number,
): number {
  const total = sessions.reduce(
    (sum, s) => sum + (s.id === sessionId ? sessionCost : (s.costUsd ?? 0)),
    0,
  );
  return Number(total.toFixed(4));
}
