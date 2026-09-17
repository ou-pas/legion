import { describe, it, expect } from "vitest";
import { DERIVED_TASK_STATES, deriveTaskState } from "./derive-task-state.js";
import { SESSION_STATUSES, type Session } from "../api/sessions.js";
import type { Task } from "../api/tasks.js";
import { SESSION_STATUS } from "../api/sessions.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

// Minimal values to build valid objects without knowing all their fields.
const minTask: Task = {
  id: "task-1",
  projectId: "project-1",
  name: "Test Task",
  description: "",
  status: TASK_STATUS.doing,
  settledOutcome: null,
  assigneeAgentId: null,
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
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
  branch: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  boardOrder: 0,
  editable: true,
  briefEditable: true,
  waitingFor: null,
  imageWait: null,
  blockedBy: [],
  runnerWait: null,
  chosenRunnerId: null,
};

const minSession: Session = {
  id: "session-1",
  taskId: "task-1",
  agentId: "agent-1",
  runnerId: "runner-1",
  model: "haiku",
  status: "running",
  costUsd: null,
  resumeCount: 0,
  startedAt: new Date().toISOString(),
  endedAt: null,
  endReason: null,
};

/** A session ended without error. What tells a success from an empty run is no longer guessed here:
 *  it is the VERDICT the server set when settling the task (`settledOutcome`). */
const ended: Session = {
  ...minSession,
  status: "destroyed",
  endReason: "the agent process exited with code 0",
};

describe("deriveTaskState", () => {
  it("returns not-started without a session: an absence is not a contradiction", () => {
    const result = deriveTaskState({ ...minTask, status: TASK_STATUS.review }, undefined);
    expect(result.state).toBe("not-started");
    expect(result.fact).toBe("No run");
  });

  describe("live sessions win over the column", () => {
    it.each(["starting", "running"] as const)("returns running for %s", (status) => {
      expect(deriveTaskState(minTask, { ...minSession, status }).state).toBe("running");
    });

    it("names finalisation during committing", () => {
      const result = deriveTaskState(minTask, { ...minSession, status: "committing" });
      expect(result.state).toBe("running");
      expect(result.fact).toBe("Finishing up");
    });
  });

  describe("the two waits are told apart", () => {
    it("waiting waits for an answer", () => {
      const result = deriveTaskState(minTask, { ...minSession, status: SESSION_STATUS.waiting });
      expect(result.state).toBe("paused");
      expect(result.fact).toBe("Session waiting for an answer");
    });

    // REGRESSION: `blocked` fell into `default` and came out "not-started": a task waiting for the
    // operator's approval showed as never run.
    it("blocked waits for an approval, and is NOT not-started", () => {
      const result = deriveTaskState(minTask, { ...minSession, status: "blocked" });
      expect(result.state).toBe("blocked");
      expect(result.fact).toBe("Stopped on an approval");
    });
  });

  describe("contradictions: returned, not merely declared", () => {
    // REGRESSION: this case came out as `failed`, and `contradiction` was never returned although
    // the type declared it.
    it("a task still doing whose session ended is a contradiction", () => {
      const task: Task = { ...minTask, status: TASK_STATUS.doing };
      const session: Session = { ...minSession, status: "failed", endReason: "exit 137" };
      const result = deriveTaskState(task, session);
      expect(result.state).toBe("contradiction");
      expect(result.fact).toBe("exit 137");
    });

    it("also holds for a session destroyed without error", () => {
      const result = deriveTaskState(
        { ...minTask, status: TASK_STATUS.doing },
        { ...minSession, status: "destroyed" },
      );
      expect(result.state).toBe("contradiction");
      expect(result.fact).toBe("Session ended while the task is still in doing");
    });

    // Measured on 03/09: the SDK returns a success carrying "API Error: 529 Overloaded", the process
    // exits 0, the task goes to review, and nothing was produced. The server records it when
    // settling (`settledOutcome: "empty"`); the screen only reads it.
    it('an "empty" verdict is a contradiction, not a success', () => {
      const task: Task = { ...minTask, status: TASK_STATUS.review, settledOutcome: "empty" };
      const result = deriveTaskState(task, ended);
      expect(result.state).toBe("contradiction");
      expect(result.fact).toBe("Ended without producing anything");
    });
  });

  describe("endings", () => {
    it("returns failed with the server's sentence", () => {
      const task: Task = { ...minTask, status: TASK_STATUS.review };
      const session: Session = {
        ...minSession,
        status: "failed",
        endReason: "container vanished without a reported result",
      };
      const result = deriveTaskState(task, session);
      expect(result.state).toBe("failed");
      expect(result.fact).toBe("container vanished without a reported result");
    });

    it("falls back on a generic sentence when endReason is missing", () => {
      const task: Task = { ...minTask, status: TASK_STATUS.review };
      expect(deriveTaskState(task, { ...minSession, status: "failed" }).fact).toBe(
        "Session failed",
      );
    });

    // REGRESSION: the original version tested `endReason === "stopped"`, a value the server never
    // writes (`markSessionTerminal` writes a sentence). The stop verdict now lives in
    // `settledOutcome`.
    it("an operator stop is not a success", () => {
      const task: Task = { ...minTask, status: TASK_STATUS.review, settledOutcome: "stopped" };
      const result = deriveTaskState(task, {
        ...ended,
        endReason: "session stopped by the operator",
      });
      expect(result.state).toBe("failed");
      expect(result.fact).toBe("session stopped by the operator");
    });

    it("returns completed on a delivery verdict, with the server's reason", () => {
      const task: Task = { ...minTask, status: TASK_STATUS.done, settledOutcome: "delivered" };
      const result = deriveTaskState(task, ended);
      expect(result.state).toBe("completed");
      expect(result.fact).toBe("the agent process exited with code 0");
    });

    // `null` = no verdict, i.e. the agent settled itself through `update_task`. The most frequent
    // case, and it must trigger nothing.
    it("returns completed without a verdict: the agent settled itself", () => {
      const task: Task = { ...minTask, status: TASK_STATUS.review, settledOutcome: null };
      expect(deriveTaskState(task, ended).state).toBe("completed");
    });
  });

  // The guard of the icon table and labels: every session status must produce a known state. This
  // is the test that would have caught the missing `blocked`.
  it("returns a known state for each of the seven session statuses", () => {
    for (const status of SESSION_STATUSES) {
      const result = deriveTaskState(
        { ...minTask, status: TASK_STATUS.review },
        { ...minSession, status },
      );
      expect(DERIVED_TASK_STATES).toContain(result.state);
      expect(result.fact).not.toBe("");
    }
  });
});
