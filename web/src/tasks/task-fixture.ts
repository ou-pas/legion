// A demo task, session and agent for the domain's stories.
//
// A module of their own because half of `tasks/` stories need them word for word: copying a
// thirty-field literal is how a field added to `Task` breaks eight files instead of one, and how
// the eight end up describing slightly different tasks without anyone deciding it.
import type { Agent } from "../api/agents.js";
import { REPO_ACCESS } from "../api/agents.js";
import type { Session } from "../api/sessions.js";
import type { Task, TaskSummary } from "../api/tasks.js";
import { COMPLEXITY, PRIORITY, TASK_STATUS } from "../api/tasks.js";

export const DEMO_AT = "2026-09-04T09:00:00.000Z";

export const demoTask = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.doing,
  settledOutcome: null,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  templateId: null,
  templateRunId: null,
  stepIndex: null,
  blockedBy: [],
  criteria: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  branch: "feature/environments-screen",
  chosenRunnerId: null,
  createdAt: DEMO_AT,
  updatedAt: DEMO_AT,
  boardOrder: 1,
  editable: true,
  briefEditable: true,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  ...over,
});

/** What a board card shows: never the brief or the criteria (cut of 02/09). */
export const demoTaskSummary = (over: Partial<TaskSummary> = {}): TaskSummary => {
  const { description: _description, criteria: _criteria, ...summary } = demoTask();
  return { ...summary, ...over } as TaskSummary;
};

export const demoSession = (over: Partial<Session> = {}): Session => ({
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "opus",
  status: "running",
  costUsd: 0.42,
  resumeCount: 0,
  startedAt: DEMO_AT,
  endedAt: null,
  endReason: null,
  ...over,
});

export const demoAgent = (over: Partial<Agent> = {}): Agent => ({
  id: "a-1",
  projectId: "p-1",
  name: "builder",
  title: "Developer",
  model: null,
  rolePrompt: "",
  environmentId: null,
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: "[]",
  repoAccess: REPO_ACCESS.none,
  runnerPreference: null,
  inboxAccess: false,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: "[]",
  ruleIds: "[]",
  repoNames: "[]",
  ...over,
});
