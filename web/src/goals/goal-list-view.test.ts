// The goal list mixed the nine statuses in database insertion order. These tests pin what a filter
// must guarantee: what it shows, and what it RELEGATES (a finished goal never rises above a live
// one, whatever its date).
import { describe, expect, it } from "vitest";
import { GOAL_STATUS, type Goal, type GoalStatus } from "../api/goals.js";
import { goalViewCounts, goalsInView, isGoalTerminal } from "./goal-list-view.js";

const goal = (id: string, status: GoalStatus, createdAt: string): Goal => ({
  id,
  projectId: "p1",
  name: id,
  request: "…",
  dod: [],
  plan: [],
  dodApproved: false,
  status,
  allowedAgentIds: [],
  budgetUsd: null,
  maxDurationMs: null,
  maxNoProgress: 3,
  spentUsd: 0,
  noProgressStreak: 0,
  iterations: 0,
  mock: false,
  createdAt,
  startedAt: null,
  endedAt: null,
});

// Deliberately in an insertion order neither chronological nor grouped by status: what `listGoals`
// returned (no `orderBy`).
const GOALS: Goal[] = [
  goal("failed-old", GOAL_STATUS.failed, "2026-08-01T09:00:00.000Z"),
  goal("active", GOAL_STATUS.active, "2026-08-20T09:00:00.000Z"),
  goal("completed-recent", GOAL_STATUS.completed, "2026-09-02T09:00:00.000Z"),
  goal("draft", GOAL_STATUS.draft, "2026-09-01T09:00:00.000Z"),
  goal("paused", GOAL_STATUS.paused, "2026-08-25T09:00:00.000Z"),
  goal("cancelled", GOAL_STATUS.cancelled, "2026-08-30T09:00:00.000Z"),
];

const names = (list: Goal[]) => list.map((g) => g.name);

describe("goalsInView: what the goal list shows", () => {
  it("`live` keeps only what is at stake; a `draft` is, since it awaits approval", () => {
    expect(names(goalsInView(GOALS, "live"))).toEqual(["draft", "paused", "active"]);
  });

  it("`done` keeps only finished runs, every stop family, `cancelled` included", () => {
    expect(names(goalsInView(GOALS, "done"))).toEqual([
      "completed-recent",
      "cancelled",
      "failed-old",
    ]);
  });

  it("`all` keeps everything but RELEGATES finished ones to the end, even the most recent", () => {
    expect(names(goalsInView(GOALS, "all"))).toEqual([
      "draft",
      "paused",
      "active",
      "completed-recent",
      "cancelled",
      "failed-old",
    ]);
  });

  it("does not mutate the input array: the query data stays the server's", () => {
    const before = names(GOALS);
    goalsInView(GOALS, "all");
    expect(names(GOALS)).toEqual(before);
  });
});

describe("goalViewCounts: what the filter says about what it hides", () => {
  it("counts the three views, `all` being the total", () => {
    expect(goalViewCounts(GOALS)).toEqual({ live: 3, done: 3, all: 6 });
  });

  it("an empty list counts nothing", () => {
    expect(goalViewCounts([])).toEqual({ live: 0, done: 0, all: 0 });
  });
});

describe("isGoalTerminal: the three guardrail stops are ends of run", () => {
  it.each([GOAL_STATUS.stoppedStuck, GOAL_STATUS.stoppedBudget, GOAL_STATUS.stoppedTime])(
    "%s is terminal",
    (status) => {
      expect(isGoalTerminal(goal("g", status, "2026-09-01T09:00:00.000Z"))).toBe(true);
    },
  );
});
