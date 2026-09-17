// Demo material for the workshop: tasks, sessions and an agent, named after real work.
//
// Only story files import this module, so it never enters the application graph or the shipped
// bundle. It exists so a list story and a status column story show THE SAME channel: two sets of
// fakes diverge within a week.
import type { Agent } from "../api/agents.js";
import type { InboxItem } from "../api/inbox.js";
import type { Session } from "../api/sessions.js";
import type { Task } from "../api/tasks.js";
import type { SessionEvent } from "../sessions/use-session-events.js";
import type { Channel } from "./channel.js";
import { SESSION_STATUS } from "../api/sessions.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";
import { REPO_ACCESS } from "../api/agents.js";

const TASK: Task = {
  id: "t1",
  projectId: "p1",
  name: "spec out discussion mode",
  description: "",
  status: TASK_STATUS.doing,
  settledOutcome: null,
  assigneeAgentId: "a1",
  modelOverride: null,
  approvalGate: true,
  readOnly: false,
  templateId: null,
  templateRunId: null,
  stepIndex: null,
  blockedBy: [],
  criteria: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.high,
  priority: PRIORITY.high,
  queued: false,
  prUrls: "[]",
  externalRef: null,
  expectedArtifacts: "[]",
  scheduledAt: null,
  branch: "chore/spec-out-discussion-mode-8d41f0a7",
  createdAt: "2026-08-25T12:29:00.000Z",
  updatedAt: "2026-08-25T13:41:00.000Z",
  boardOrder: 1,
  editable: false,
  briefEditable: true,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
};

const SESSION: Session = {
  id: "s1",
  taskId: "t1",
  agentId: "a1",
  runnerId: "r1",
  model: "opus",
  status: SESSION_STATUS.waiting,
  costUsd: 1.08,
  resumeCount: 2,
  startedAt: "2026-08-25T12:30:00.000Z",
  endedAt: null,
  endReason: null,
};

export const AGENT: Agent = {
  id: "a1",
  projectId: "p1",
  name: "spec",
  title: "Spec",
  model: "opus",
  rolePrompt: "",
  environmentId: "e1",
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: '["GITHUB_TOKEN"]',
  repoAccess: REPO_ACCESS.read,
  runnerPreference: null,
  inboxAccess: true,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: "[]",
  ruleIds: "[]",
  repoNames: '["legion"]',
};

/** An OPEN form question: the kind answered IN the thread. */
export const QUESTION: InboxItem = {
  id: "i1",
  kind: "form",
  body: "Three decisions before writing the spec.",
  evidence: null,
  impact: "discussion mode and its session resume",
  choices: null,
  form: {
    blocks: [
      {
        kind: "field",
        field: {
          id: "survive",
          label: "What survives a pause",
          type: "radio",
          required: true,
          options: [
            { id: "none", label: "nothing, status quo" },
            { id: "vol", label: "a /workspace volume per session" },
          ],
          default: "vol",
        },
      },
      {
        kind: "field",
        field: {
          id: "cache",
          label: "A shared package cache",
          type: "checkbox",
          default: true,
        },
      },
    ],
  },
  taskId: "t1",
  taskName: "spec out discussion mode",
  agentName: "spec",
  sessionId: "s1",
  createdAt: 1_756_129_260_000,
  wakeAt: null,
  waitForTaskId: null,
  waitForTaskName: null,
  waitForTaskStatus: null,
  reason: "question",
  // v62 (07/09): the round counts only its two fields and nobody started it, the card's
  // "nothing answered" state, the one saying "Answer".
  answered: 0,
  total: 2,
  draft: null,
  draftAt: null,
  roundIndex: 1,
  projectId: "p1",
};

/** The SAME question, in variants: short choices, free text only, diagnosis. One template, so
 *  the action band shows exactly the question the thread shows. */
export const question = (over: Partial<InboxItem> = {}): InboxItem => ({ ...QUESTION, ...over });

/** A channel per state. `at` is frozen: a story never reads the clock. */
export const channel = (over: Partial<Channel> & { name?: string } = {}): Channel => ({
  task: { ...TASK, ...(over.name ? { name: over.name, id: over.name } : {}) },
  session: SESSION,
  state: "waiting",
  question: null,
  gate: true,
  /** No failure by default, the nominal case. A story wanting the failure passes it. */
  failure: null,
  at: 1_756_129_260_000,
  ...over,
});

/** Frozen timestamps: a story never reads the clock. */
const T0 = 1_756_125_060_000;
const ev = (type: string, data: Record<string, unknown>, min: number): SessionEvent => ({
  type,
  data: { ...data, ts: T0 + min * 60_000 },
});

/** When the task was set: the pinned brief carries that time. */
export const BRIEF_AT = T0 - 60_000;

/** A real INTERVIEW session stream: two rounds, work between them, an incident and a steer. The
 *  stories feed it through `transcript()` rather than a hand-written segment list, to check the
 *  split holds on more than what we had in mind. Shared by the stream, thread and tab stories. */
export const FLUX: SessionEvent[] = [
  ev("init", { model: "opus" }, 0),
  ev(
    "text",
    { text: "I'm loading the **grilling** skill and reading the code before asking anything." },
    1,
  ),
  ev("tool_start", { tool: "Read", input: "runner-payload/session-runner.mjs" }, 2),
  ev("tool_end", { durationMs: 320 }, 2),
  ev("tool_start", { tool: "Grep", input: "validateFormSpec server/src/inbox/" }, 3),
  ev("tool_start", { tool: "Read", input: "web/src/api/inbox.ts" }, 4),
  ev("inbox_ask", { inboxId: "i0", body: "Six questions about discussion mode's scope." }, 5),
  ev(
    "inbox_answer",
    {
      inboxId: "i0",
      answer: JSON.stringify({
        scope: "web only",
        entry: "both entry points",
        sleep: "sleeps indefinitely",
      }),
    },
    32,
  ),
  ev(
    "run_error",
    {
      message: 'proxy run failed: the container name "legion-proxy-0WpRyW8bF9d1" is already in use',
    },
    51,
  ),
  ev("steer", { text: "resume with the decisions already settled, don't re-ask round 1" }, 55),
  ev("steer_delivered", { steerId: "st1" }, 55),
  ev("text", { text: "Resuming. I'm keeping the six answers from round 1 and moving on." }, 56),
  ev("inbox_ask", { inboxId: "i1", body: "Three decisions before writing the spec." }, 71),
];

/** The brief as it was submitted: three lines, exactly the thin instruction the discussion mode
 *  exists to test. */
export const BRIEF = [
  "You write a title and a brief, and the task ships. If the brief is thin, the agent discovers",
  "the gaps along the way. I want to be able to DISCUSS a feature before launching it.",
  "",
  "To settle during the interview: where the thread is read, and what survives a pause.",
].join("\n");
