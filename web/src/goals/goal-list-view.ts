// What the goal list shows, and in which order. The rule is domain vocabulary, not drawing.
//
// The list rendered goals in database INSERTION order (`listGoals` does not sort), all statuses
// mixed: last week's `failed` read as a progressing goal, and an older project drowned its three live
// goals in fifteen dead ones. Nothing is archived (decision D1: no archiving, no column, no
// migration); a finished goal stays one click away.
import { TERMINAL_GOAL_STATUSES, type Goal } from "../api/goals.js";

/** `live` is the default: what is at stake. */
export const GOAL_VIEWS = ["live", "done", "all"] as const;
export type GoalView = (typeof GOAL_VIEWS)[number];

export const isGoalTerminal = (goal: Goal): boolean => TERMINAL_GOAL_STATUSES.includes(goal.status);

/** Most recent first: at equal status, the only order not left to insertion chance. `createdAt` is
 *  ISO, so its lexicographic comparison IS chronological, without a `Date.parse` per item. */
const newestFirst = (a: Goal, b: Goal): number => b.createdAt.localeCompare(a.createdAt);

/** Filtered, finished goals relegated to the end (`all` view), most recent first within each group. */
export function goalsInView(goals: Goal[], view: GoalView): Goal[] {
  const kept =
    view === "all" ? goals : goals.filter((g) => isGoalTerminal(g) === (view === "done"));
  return [...kept].sort(
    (a, b) => Number(isGoalTerminal(a)) - Number(isGoalTerminal(b)) || newestFirst(a, b),
  );
}

/** Each tab's count: it says what is NOT visible, half the point of a filter. */
export function goalViewCounts(goals: Goal[]): Record<GoalView, number> {
  const done = goals.filter(isGoalTerminal).length;
  return { live: goals.length - done, done, all: goals.length };
}
