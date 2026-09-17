// The summary context the concierge receives, compiled by the server. Its read-only tools
// (`concierge-tools.ts`) fetch the detail this summary does not carry.
//
// Scope: the concierge is not tied to a project (`conciergeApi.ask` takes no `projectId`), so the
// context spans every project, like `GET /api/tasks`.
import { listOpenInbox } from "../inbox/inbox.js";
import {
  allAgents,
  allProjects,
  allTasks,
  sessionsStartedSince,
} from "./concierge-context-store.js";

export interface ConciergeTaskSummary {
  /** The real task id (slice nav/10), so the situation report can cite tasks and the screen can
   *  link them. The server checks afterwards that a cited id was in this list. */
  id: string;
  name: string;
  projectName: string;
  // The task's project (nav/B): `projectName` is a label for the model, not an id for a link.
  // Always set: `tasks.project_id` is never null.
  projectId: string;
  status: string;
  updatedAt: number;
}

export interface ConciergeSessionSummary {
  taskName: string;
  agentName: string;
  status: string;
  model: string;
  costUsd: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface ConciergePendingQuestion {
  /** The task the question is about, where one goes to answer it. */
  taskId: string;
  taskName: string;
  // Same reason as on `ConciergeTaskSummary`. `null` if the task has since disappeared
  // (`inbox.ts` returns `""` in that case).
  projectId: string | null;
  body: string;
  createdAt: number;
}

export interface ConciergeContextData {
  generatedAt: number;
  tasks: ConciergeTaskSummary[];
  sessions: ConciergeSessionSummary[];
  cost: { windowDays: number; totalUsd: number; runningCount: number };
  pendingQuestions: ConciergePendingQuestion[];
}

const TASK_LIMIT = 12;
const SESSION_DISPLAY_LIMIT = 8;
const QUESTION_LIMIT = 10;
const COST_WINDOW_DAYS = 7;

/** Compiles the concierge context at `now` (injectable, so tests do not depend on the clock). */
export function fetchConciergeContext(now = new Date()): ConciergeContextData {
  const projects = new Map(allProjects().map((p) => [p.id, p.name]));
  const agents = new Map(allAgents().map((a) => [a.id, a.name]));
  const tasksById = new Map(allTasks().map((t) => [t.id, t]));

  const tasks = [...tasksById.values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, TASK_LIMIT)
    .map((t) => ({
      id: t.id,
      name: t.name,
      projectName: projects.get(t.projectId) ?? "?",
      projectId: t.projectId,
      status: t.status,
      updatedAt: t.updatedAt.getTime(),
    }));

  // The 7-day cost window is also the pool for displayed sessions: one query, one meaning of
  // "recent".
  const cutoff = new Date(now.getTime() - COST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentSessions = sessionsStartedSince(cutoff);

  const totalUsd = recentSessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const runningCount = recentSessions.filter(
    (s) => s.status === "running" || s.status === "starting",
  ).length;

  const sessions = recentSessions.slice(0, SESSION_DISPLAY_LIMIT).map((s) => ({
    taskName: tasksById.get(s.taskId)?.name ?? "?",
    agentName: agents.get(s.agentId) ?? "?",
    status: s.status,
    model: s.model,
    costUsd: s.costUsd ?? null,
    startedAt: s.startedAt.getTime(),
    endedAt: s.endedAt?.getTime() ?? null,
  }));

  const pendingQuestions = listOpenInbox()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, QUESTION_LIMIT)
    .map((q) => ({
      taskId: q.taskId,
      taskName: q.taskName,
      projectId: q.projectId || null,
      body: q.body,
      createdAt: q.createdAt,
    }));

  return {
    generatedAt: now.getTime(),
    tasks,
    sessions,
    cost: { windowDays: COST_WINDOW_DAYS, totalUsd, runningCount },
    pendingQuestions,
  };
}
