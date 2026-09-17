// Translation between a goal's RAILS and the three text fields editing them. Apart from the modal
// because it carries a rule: an empty field is a VALUE ("no cap"), and non-numeric input must be
// refused here. Vital because `Number("12a")` is NaN and `JSON.stringify(NaN)` gives `null`, which
// the server reads as "no cap": a budget typo would silently REMOVE the budget.
import type { GoalPatch } from "../api/goals.js";

const HOUR_MS = 3_600_000;

/** The three rails as typed: strings, `""` included. */
export type RailsDraft = { budget: string; hours: string; noProgress: string };

/** Field state on open. Duration goes from database ms to API hours without float decimals: `0.5`,
 *  not `0.5000000000000001`. */
export function railsDraftOf(goal: {
  budgetUsd: number | null;
  maxDurationMs: number | null;
  maxNoProgress: number;
}): RailsDraft {
  return {
    budget: goal.budgetUsd === null ? "" : String(goal.budgetUsd),
    hours:
      goal.maxDurationMs === null ? "" : String(Number((goal.maxDurationMs / HOUR_MS).toFixed(4))),
    noProgress: String(goal.maxNoProgress),
  };
}

/** A cap: empty = `null` (no cap), otherwise a strictly positive number. */
function cap(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A count: an integer of at least 1, never empty, so the loop always has a stop threshold. */
function count(raw: string): number | undefined {
  const text = raw.trim();
  const value = Number(text);
  return text && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The patch to send, or `null` if any field does not read as a number. */
export function railsPatch(draft: RailsDraft): GoalPatch | null {
  const budgetUsd = cap(draft.budget);
  const maxHours = cap(draft.hours);
  const maxNoProgress = count(draft.noProgress);
  if (budgetUsd === undefined || maxHours === undefined || maxNoProgress === undefined) return null;
  return { budgetUsd, maxHours, maxNoProgress };
}
