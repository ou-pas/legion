import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConciergePrompt,
  CONCIERGE_SYSTEM_PROMPT,
  formatConciergeContext,
} from "./concierge-prompt.js";
import type { ConciergeContextData } from "./concierge-context.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { CHAT_ROLE } from "./chat-enums.js";

const EMPTY_CONTEXT: ConciergeContextData = {
  generatedAt: 1_700_000_000_000,
  tasks: [],
  sessions: [],
  cost: { windowDays: 7, totalUsd: 0, runningCount: 0 },
  pendingQuestions: [],
};

const FULL_CONTEXT: ConciergeContextData = {
  generatedAt: 1_700_000_000_000,
  tasks: [
    {
      id: "tk42",
      name: "Fix the footer",
      projectName: "Legion",
      projectId: "p-legion",
      status: TASK_STATUS.doing,
      updatedAt: 1_700_000_001_000,
    },
  ],
  sessions: [
    {
      taskName: "Fix the footer",
      agentName: "senior-dev",
      status: "running",
      model: "sonnet",
      costUsd: 1.234,
      startedAt: 1_700_000_002_000,
      endedAt: null,
    },
  ],
  cost: { windowDays: 7, totalUsd: 12.5, runningCount: 1 },
  pendingQuestions: [
    {
      taskId: "tk42",
      taskName: "Fix the footer",
      projectId: "p-legion",
      body: "which button style?",
      createdAt: 1_700_000_003_000,
    },
  ],
};

describe("formatConciergeContext", () => {
  it("states absence explicitly rather than leaving a section empty", () => {
    const text = formatConciergeContext(EMPTY_CONTEXT);
    assert.match(text, /\(no task\)/);
    assert.match(text, /\(no recent session\)/);
    assert.match(text, /\(no pending question\)/);
  });

  it("renders each section from the real data, nothing invented", () => {
    const text = formatConciergeContext(FULL_CONTEXT);
    assert.match(text, /Fix the footer/);
    assert.match(text, /Legion/);
    assert.match(text, /senior-dev/);
    assert.match(text, /\$1\.23/);
    assert.match(text, /\$12\.50 over the last 7 days/);
    assert.match(text, /which button style\?/);
  });

  it("writes the id of citable objects, which the screen links from (not the agent)", () => {
    const text = formatConciergeContext(FULL_CONTEXT);
    assert.match(text, /task=tk42 \[Legion\]/);
    assert.match(text, /task=tk42 \[Fix the footer\]/);
  });

  it("is deterministic (no wall-clock dependency)", () => {
    assert.equal(formatConciergeContext(FULL_CONTEXT), formatConciergeContext(FULL_CONTEXT));
  });
});

describe("buildConciergePrompt", () => {
  it("replays the history as-is, then asks the current question", () => {
    const prompt = buildConciergePrompt(
      {
        message: "and the costs?",
        history: [
          { role: CHAT_ROLE.user, content: "what's new?" },
          { role: CHAT_ROLE.assistant, content: "nothing special" },
        ],
      },
      EMPTY_CONTEXT,
    );
    assert.match(prompt, /Operator: what's new\?/);
    assert.match(prompt, /Concierge: nothing special/);
    assert.match(prompt, /and the costs\?/);
    assert.ok(prompt.indexOf("nothing special") < prompt.indexOf("and the costs?"));
  });

  it("says so when the history is empty", () => {
    const prompt = buildConciergePrompt({ message: "hi", history: [] }, EMPTY_CONTEXT);
    assert.match(prompt, /\(no previous exchange\)/);
  });
});

describe("CONCIERGE_SYSTEM_PROMPT", () => {
  it("states read-only in plain words (an explanation for the model, not the guarantee)", () => {
    assert.match(CONCIERGE_SYSTEM_PROMPT, /READ-ONLY/);
  });

  // The regex keeps the French words: the old prompt said "answer in French".
  it("imposes no language: the concierge answers in the operator's", () => {
    assert.doesNotMatch(CONCIERGE_SYSTEM_PROMPT, /French|français|English|anglais/i);
  });

  it("forbids emoji: the answer is rendered in an interface that uses none", () => {
    assert.match(CONCIERGE_SYSTEM_PROMPT, /emoji/);
  });
});
