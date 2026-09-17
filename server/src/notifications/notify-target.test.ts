// Where a notification leads (14/09): each event opens the screen where the gesture happens, and
// a URL is never half-built, since an incomplete path opens an error screen.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTIF_EVENTS } from "./notify-enums.js";
import { notifTarget } from "./notify-target.js";

const full = { projectId: "p1", taskId: "t1" };

describe("notifTarget", () => {
  it("opens the channel for what waits for an answer", () => {
    assert.equal(notifTarget("inbox_question", full), "/p/p1/channels/t1");
  });

  it("opens the PR view for a gate and for PRs", () => {
    assert.equal(notifTarget("gate_waiting", full), "/p/p1/tasks/t1/pr");
    assert.equal(notifTarget("pr_merged", full), "/p/p1/tasks/t1/pr");
  });

  it("opens the trace for a failure", () => {
    assert.equal(notifTarget("task_failed", full), "/p/p1/tasks/t1/timeline");
  });

  // The one that would break silently: an instance notification (the standup) has no project
  // and no task.
  it("falls back to the root without a project, to the board without a task", () => {
    assert.equal(notifTarget("standup", {}), "/");
    assert.equal(notifTarget("task_failed", { taskId: "t1" }), "/");
    assert.equal(notifTarget("goal_completed", { projectId: "p1" }), "/p/p1/board");
  });

  it("returns a complete absolute path for every subscribable event", () => {
    for (const event of NOTIF_EVENTS) {
      const target = notifTarget(event, full);
      assert.ok(target.startsWith("/"), `${event}: relative path`);
      assert.ok(!target.includes("undefined") && !target.includes("//"), `${event}: ${target}`);
    }
  });

  // Without this filter the URL would become `/p//board`.
  it("does not take a blank string for an id", () => {
    assert.equal(notifTarget("gate_waiting", { projectId: "  ", taskId: "t1" }), "/");
  });
});
