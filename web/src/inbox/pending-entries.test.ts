// The waiting panel must show only what stops, under the right project. The risk is the DEFINITION:
// the day a notice, a review task without gate or an answered question slips in, the bar count stops
// being a debt that reaches zero and nobody looks at it. Each test sets a trap of that family in the
// same data set.
//
// Since 07/09 an entry carries where the gesture LEADS (`question`) and what it SAYS (`action`): a round
// goes to its page and announces Resume when started; everything else goes to its task.
import { describe, expect, it } from "vitest";
import type { InboxItem } from "../api/inbox.js";
import type { Task } from "../api/tasks.js";
import { pendingGroups } from "./pending-entries.js";
import { TASK_STATUS } from "../api/tasks.js";
import { INBOX_KIND } from "../api/inbox.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

const NOW = Date.parse("2026-08-29T12:00:00Z");
const LEGION = { id: "prj-ag", name: "Legion" };
const KOPEE = { id: "prj-kp", name: "Kopee.me" };

function task(over: Partial<Task> & Pick<Task, "id" | "projectId">): Task {
  return {
    name: "Task",
    description: "",
    status: TASK_STATUS.doing,
    assigneeAgentId: null,
    modelOverride: null,
    approvalGate: false,
    templateId: null,
    templateRunId: null,
    stepIndex: null,
    goalId: null,
    archived: false,
    complexity: COMPLEXITY.med,
    priority: PRIORITY.med,
    queued: false,
    prUrls: "[]",
    externalRef: null,
    expectedArtifacts: "[]",
    scheduledAt: null,
    criteria: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW - 120_000).toISOString(),
    boardOrder: 1,
    ...over,
  } as Task;
}

function question(id: string, taskId: string, taskName: string, ageMin: number): InboxItem {
  return {
    id,
    kind: INBOX_KIND.text,
    body: `question ${id}`,
    evidence: null,
    impact: null,
    choices: null,
    form: null,
    taskId,
    taskName,
    agentName: "Probe",
    sessionId: "s1",
    createdAt: NOW - ageMin * 60_000,
    wakeAt: null,
    waitForTaskId: null,
    waitForTaskName: null,
    waitForTaskStatus: null,
    reason: "question",
    // v62 (07/09): a round's count and draft. Zero here: this test only lists text questions, which
    // have no questionnaire.
    answered: 0,
    total: 0,
    draft: null,
    draftAt: null,
    roundIndex: null,
    projectId: "prj-ag",
  };
}

describe("what is stopped, grouped by project", () => {
  it("groups by project, in rail order, and skips projects with nothing", () => {
    const tasks = [
      task({ id: "t1", projectId: LEGION.id, name: "Probe" }),
      task({ id: "t2", projectId: KOPEE.id, name: "Webhook" }),
    ];
    const groups = pendingGroups({
      inbox: [question("q2", "t2", "Webhook", 22), question("q1", "t1", "Probe", 8)],
      tasks,
      projects: [LEGION, KOPEE, { id: "prj-vide", name: "Rien" }],
      now: NOW,
    });
    expect(groups.map((g) => g.project.id)).toEqual([LEGION.id, KOPEE.id]);
    expect(groups[0]?.entries.map((e) => e.taskId)).toEqual(["t1"]);
    expect(groups[1]?.entries.map((e) => e.taskId)).toEqual(["t2"]);
  });

  it("counts a gate in review, and NOTHING else among tasks", () => {
    const tasks = [
      // The only one that stops: approval gate AND in review.
      task({
        id: "gate",
        projectId: LEGION.id,
        name: "Breakdown",
        approvalGate: true,
        status: TASK_STATUS.review,
      }),
      // Three traps: a gate not in review yet, a review without gate, a finished gate.
      task({ id: "p1", projectId: LEGION.id, approvalGate: true, status: TASK_STATUS.doing }),
      task({ id: "p2", projectId: LEGION.id, approvalGate: false, status: TASK_STATUS.review }),
      task({ id: "p3", projectId: LEGION.id, approvalGate: true, status: TASK_STATUS.done }),
    ];
    const groups = pendingGroups({ inbox: [], tasks, projects: [LEGION], now: NOW });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.taskId)).toEqual(["gate"]);
    expect(groups[0]?.entries[0]?.kind).toBe("gate");
  });

  it("oldest first: it waited longest", () => {
    const tasks = [task({ id: "t1", projectId: LEGION.id, name: "Probe" })];
    const groups = pendingGroups({
      inbox: [question("recent", "t1", "Probe", 2), question("old", "t1", "Probe", 40)],
      tasks,
      projects: [LEGION],
      now: NOW,
    });
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["q-old", "q-recent"]);
    expect(groups[0]?.entries[0]?.meta).toBe("Probe · 40 min");
  });

  it("a question whose task is not loaded is filed nowhere rather than anywhere", () => {
    const groups = pendingGroups({
      inbox: [question("orpheline", "inconnue", "Disparue", 5)],
      tasks: [],
      projects: [LEGION],
      now: NOW,
    });
    expect(groups).toEqual([]);
  });

  it("a wait that wakes BY ITSELF is not a decision: it stays out", () => {
    // Slice nav/11. The panel must say the SAME as the badge, which only counts what awaits a decision
    // (server/src/inbox/pending-by-project.ts). A session asleep on another task or until a time calls
    // nobody.
    const tasks = [task({ id: "t1", projectId: LEGION.id, name: "Probe" })];
    const groups = pendingGroups({
      inbox: [
        {
          ...question("dep", "t1", "Probe", 30),
          waitForTaskId: "t9",
          waitForTaskName: "Migration",
          waitForTaskStatus: TASK_STATUS.doing,
        },
        { ...question("quota", "t1", "Probe", 20), wakeAt: NOW + 3_600_000 },
        question("real", "t1", "Probe", 10),
      ],
      tasks,
      projects: [LEGION],
      now: NOW,
    });
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["q-real"]);
  });

  it("A ROUND LEADS TO ITS PAGE with its count; a text question leads to its task", () => {
    const tasks = [task({ id: "t1", projectId: LEGION.id, name: "AI-2200" })];
    const round = { ...question("r", "t1", "AI-2200", 112), total: 6, answered: 2, roundIndex: 1 };
    const groups = pendingGroups({
      inbox: [round, question("libre", "t1", "AI-2200", 4)],
      tasks,
      projects: [LEGION],
      now: NOW,
    });
    const [first, second] = groups[0]!.entries;
    // Oldest first: the round.
    expect(first?.meta).toBe("AI-2200 · 2 / 6 · 1 h 52");
    expect(first?.question).toEqual({ projectId: LEGION.id, inboxId: "r" });
    expect(first?.action).toBe("Resume");
    // A text question has no page: it is answered in its channel, so the click leads to the task.
    expect(second?.question).toBeNull();
    expect(second?.action).toBe("Answer");
    expect(second?.meta).toBe("AI-2200 · 4 min");
  });

  it('an unreadable update date does not render "NaN min"', () => {
    const tasks = [
      task({
        id: "gate",
        projectId: LEGION.id,
        name: "Breakdown",
        approvalGate: true,
        status: TASK_STATUS.review,
        updatedAt: "not a date",
      }),
    ];
    const groups = pendingGroups({ inbox: [], tasks, projects: [LEGION], now: NOW });
    expect(groups[0]?.entries[0]?.meta).toBe("Breakdown · gate · 0 min");
  });
});
