import { json, patch, post } from "./client.js";
import type { Task } from "./tasks.js";

/** The nine goal statuses, mirror of `GOAL_STATUS` (server/src/goals/goal-status.ts). This family
 *  was already renamed once (`cancelled` split from `failed`, v54): the constant makes the next time
 *  painless. */
export const GOAL_STATUS = {
  /** Created, DoD generated, nothing runs: the loop only exists after human approval. */
  draft: "draft",
  active: "active",
  paused: "paused",
  completed: "completed",
  /** The three guardrail stops say WHICH one cut. */
  stoppedStuck: "stopped-stuck",
  stoppedBudget: "stopped-budget",
  stoppedTime: "stopped-time",
  /** The loop broke. */
  failed: "failed",
  /** The operator changed their mind, distinct from a failure (v54). */
  cancelled: "cancelled",
} as const;

export const GOAL_STATUSES = [
  GOAL_STATUS.draft,
  GOAL_STATUS.active,
  GOAL_STATUS.paused,
  GOAL_STATUS.completed,
  GOAL_STATUS.stoppedStuck,
  GOAL_STATUS.stoppedBudget,
  GOAL_STATUS.stoppedTime,
  GOAL_STATUS.failed,
  GOAL_STATUS.cancelled,
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** A LIVE goal: the loop runs, or will resume. Annotated `readonly GoalStatus[]` on purpose: a
 *  literal array narrows `includes` to its own members and would refuse the status being tested. */
export const LIVE_GOAL_STATUSES: readonly GoalStatus[] = [GOAL_STATUS.active, GOAL_STATUS.paused];

/** Statuses where a goal's RAILS can still move, mirror of `RAIL_EDITABLE`
 *  (server/src/goals/goal-edit.ts): the loop rereads a rail every turn, so moving it takes effect
 *  at once without rewriting the past. The BRIEF is editable only in `draft`: after approval the
 *  request is already in the loop. That is why the two gestures are unequal on screen. */
export const RAIL_EDITABLE_GOAL_STATUSES: readonly GoalStatus[] = [
  GOAL_STATUS.draft,
  GOAL_STATUS.active,
  GOAL_STATUS.paused,
];

/** A goal whose run is over: nothing is decided or editable anymore. The list uses it to keep
 *  closed goals apart from moving ones, without archiving (decision D1). */
export const TERMINAL_GOAL_STATUSES: readonly GoalStatus[] = [
  GOAL_STATUS.completed,
  GOAL_STATUS.stoppedStuck,
  GOAL_STATUS.stoppedBudget,
  GOAL_STATUS.stoppedTime,
  GOAL_STATUS.failed,
  GOAL_STATUS.cancelled,
];

/** What deleting a goal would destroy, like `ProjectFootprint` (`api/projects.ts`) but with the
 *  artifacts folder as a boolean: a goal has ONE folder shared by all its tasks
 *  (server/src/goals/goal-delete.ts). */
export type GoalFootprint = {
  tasks: number;
  sessions: number;
  sessionEvents: number;
  inbox: number;
  reviewComments: number;
  activity: number;
  goalEvents: number;
  artifactsDir: boolean;
};
/** A still-live session of a goal task: what blocks or delays deletion. */
export type LiveGoalSession = { id: string; status: string; taskName: string };
/** A task OUTSIDE the goal unblocked by the deletion (D10): it was waiting on a goal task. */
export type UnblockedTask = { id: string; name: string };

export type DodItem = { id: string; text: string; done: boolean };
export type PlanStep = { step: string; agentName: string; why: string };
export type Goal = {
  id: string;
  projectId: string;
  name: string;
  request: string;
  dod: DodItem[];
  plan: PlanStep[];
  dodApproved: boolean;
  /** `cancelled` = stopped by the operator (kill switch); `failed` = broke by itself. */
  status: GoalStatus;
  allowedAgentIds: string[];
  budgetUsd: number | null;
  maxDurationMs: number | null;
  maxNoProgress: number;
  spentUsd: number;
  noProgressStreak: number;
  iterations: number;
  mock: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};
export type GoalDetail = Goal & {
  events: { id: number; type: string; payload: Record<string, unknown>; ts: number }[];
  tasks: Task[];
};

/** An absent field is untouched; `null` on a rail = "no cap", which is a value, not an absence. */
export type GoalPatch = {
  name?: string;
  request?: string;
  budgetUsd?: number | null;
  maxHours?: number | null;
  maxNoProgress?: number;
  allowedAgentIds?: string[];
};
export type GoalEditResponse = {
  ok: true;
  goal: Goal;
  /** Fields whose value actually changed; empty if the form was submitted as is. */
  changed: (keyof GoalPatch)[];
  dod?: DodItem[];
  plan?: PlanStep[];
  warning?: string;
};

export const goalsApi = {
  goals: (projectId?: string): Promise<Goal[]> =>
    fetch(`/api/goals${projectId ? `?projectId=${projectId}` : ""}`).then(json),
  goal: (id: string): Promise<GoalDetail> => fetch(`/api/goals/${id}`).then(json),
  /** 201 even when DoD generation fails: the goal EXISTS with an empty DoD, and `warning` says why.
   *  The type used to omit it, so a goal left the composer with an empty DoD and no reason shown. */
  createGoal: (body: {
    projectId: string;
    name: string;
    request: string;
    budgetUsd?: number;
    maxHours?: number;
    allowedAgentIds?: string[];
  }): Promise<{ id: string; dod: DodItem[]; plan: PlanStep[]; warning?: string }> =>
    post("/api/goals", body),
  /** The server refuses what the current state no longer allows: the BRIEF (`name`, `request`,
   *  `allowedAgentIds`) only in `draft`, the RAILS (`budgetUsd`, `maxHours`, `maxNoProgress`) until
   *  the goal ends. Changing `request` regenerates DoD and plan, returned in the response; `warning`
   *  says they could NOT be (the edit is saved anyway, `regenerateGoal` catches up). */
  editGoal: (id: string, body: GoalPatch): Promise<GoalEditResponse> =>
    patch(`/api/goals/${id}`, body),
  /** Redoes a `draft` goal's DoD and plan without touching the request. */
  regenerateGoal: (id: string): Promise<{ ok: true; dod: DodItem[]; plan: PlanStep[] }> =>
    post(`/api/goals/${id}/regenerate`),
  approveGoal: (id: string, items: { id: string; text: string }[]) =>
    post(`/api/goals/${id}/approve`, { items }),
  goalAction: (id: string, action: "pause" | "resume" | "kill") =>
    post(`/api/goals/${id}/${action}`),
  goalFromIssues: (body: {
    projectId: string;
    name?: string;
    issues: { identifier: string; title: string; url: string }[];
    budgetUsd?: number;
  }): Promise<{ id: string }> => post("/api/goals/from-issues", body),
  /** What deletion would destroy, plus the live sessions delaying it and the outside tasks it frees. */
  goalFootprint: (
    id: string,
  ): Promise<{ footprint: GoalFootprint; live: LiveGoalSession[]; unblocks: UnblockedTask[] }> =>
    fetch(`/api/goals/${id}/footprint`).then(json),
  /** Hard delete (D1): the goal, its log and all its tasks go. 409 while a session still pushes its
   *  branch, or while the goal is `active`/`paused` (kill it first). */
  deleteGoal: (
    id: string,
  ): Promise<{
    ok: true;
    deleted: string;
    footprint: GoalFootprint;
    unblocked: UnblockedTask[];
    closedWaits: string[];
  }> => fetch(`/api/goals/${id}`, { method: "DELETE" }).then(json),
};
