// The situation report (slice nav/10, AC#2): computed on demand and cached with its timestamp; a
// second visit within the cache window makes no model call, and no timer computes it.
//
// The absence of a timer is tested two ways: the simulated clock proves nothing fires on its own
// over a day, and the source scan proves no domain file arms one, including at import time,
// before the simulated clock is in place.
//
// `run` is a fake, never the real SDK.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import {
  buildBriefPrompt,
  clearConciergeBriefCache,
  conciergeBrief,
  hasSomethingToTell,
  parseBrief,
  BRIEF_SYSTEM_PROMPT,
} from "./concierge-brief.js";
import type { ConciergeContextData } from "./concierge-context.js";
import type { ConciergeResult } from "./concierge.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";

const NOW = 1_700_000_000_000;

const EMPTY: ConciergeContextData = {
  generatedAt: NOW,
  tasks: [],
  sessions: [],
  pendingQuestions: [],
  cost: { windowDays: 7, totalUsd: 0, runningCount: 0 },
};

const FULL: ConciergeContextData = {
  generatedAt: NOW,
  tasks: [
    {
      id: "tk09",
      name: "Slice 09",
      projectName: "Legion",
      projectId: "Legion",
      status: TASK_STATUS.doing,
      updatedAt: NOW,
    },
    {
      id: "tk10",
      name: "Slice 10",
      projectName: "Koala",
      projectId: "Koala",
      status: TASK_STATUS.todo,
      updatedAt: NOW,
    },
  ],
  sessions: [],
  cost: { windowDays: 7, totalUsd: 18.4, runningCount: 1 },
  pendingQuestions: [
    {
      taskId: "tk09",
      taskName: "Slice 09",
      projectId: "Legion",
      body: "where do I write?",
      createdAt: NOW,
    },
  ],
};

const REPLY = JSON.stringify({
  prose: ["Three sessions running, all on Legion."],
  items: [{ severity: "now", text: "Slice 09 has been stopped for 40 min.", task: "tk09" }],
});

/** A fake `runConciergeQuery` that counts its calls: the counter carries the whole AC. */
function counter(result: ConciergeResult = { ok: true, reply: REPLY }) {
  const calls: string[] = [];
  const run = async (prompt: string): Promise<ConciergeResult> => {
    calls.push(prompt);
    return result;
  };
  return { calls, run: run as never };
}

beforeEach(() => clearConciergeBriefCache());

describe("cache: a call happens only when the age justifies it", () => {
  it("computes on the first call, stamped with the computation time", async () => {
    const { calls, run } = counter();
    const brief = await conciergeBrief({}, { run, context: () => FULL, now: () => NOW });
    assert.equal(calls.length, 1);
    assert.equal(brief.reason, "computed");
    assert.equal(brief.generatedAt, NOW);
  });

  it("makes no model call on a second visit within the window", async () => {
    const { calls, run } = counter();
    const deps = { run, context: () => FULL };
    await conciergeBrief({}, { ...deps, now: () => NOW });
    const again = await conciergeBrief({}, { ...deps, now: () => NOW + 60_000 });
    assert.equal(calls.length, 1, "the second call must be served from the cache");
    // Same timestamp: the screen shows the report's real age, not the read's.
    assert.equal(again.generatedAt, NOW);
  });

  it("calls again past the window", async () => {
    const { calls, run } = counter();
    const deps = { run, context: () => FULL };
    await conciergeBrief({}, { ...deps, now: () => NOW });
    await conciergeBrief({}, { ...deps, now: () => NOW + 3_600_000 });
    assert.equal(calls.length, 2);
  });

  it("recomputes at once on `refresh`", async () => {
    const { calls, run } = counter();
    const deps = { run, context: () => FULL };
    await conciergeBrief({}, { ...deps, now: () => NOW });
    await conciergeBrief({ refresh: true }, { ...deps, now: () => NOW + 1_000 });
    assert.equal(calls.length, 2);
  });

  it("keeps the last known report on failure and adds the reason", async () => {
    const ok = counter();
    await conciergeBrief({}, { run: ok.run, context: () => FULL, now: () => NOW });
    const ko = counter({ ok: false, status: 504, error: "timed out (15 s)" });
    const after = await conciergeBrief(
      { refresh: true },
      { run: ko.run, context: () => FULL, now: () => NOW + 1_000 },
    );
    assert.equal(after.reason, "computed");
    assert.equal(after.items.length, 1, "the last report's lines are still there");
    assert.match(after.error!, /timed out/);
    assert.equal(after.generatedAt, NOW, "the displayed age is the real computation's");
  });
});

describe("no timer computes it", () => {
  it("lets a simulated day pass without a single model call", async (t) => {
    const { calls, run } = counter();
    // Empty cache, window long past: anything recomputing on its own would fire within a day.
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    assert.equal(calls.length, 0);
    // Asking is enough to get one: silence is not a failure.
    await conciergeBrief({}, { run, context: () => FULL, now: () => NOW });
    assert.equal(calls.length, 1);
  });

  // A source scan on purpose: this asserts the absence of a construct across the domain,
  // including files not written yet. No import could prove it.
  it("no domain file arms a timer, including at import", () => {
    const dir = new URL(".", import.meta.url).pathname;
    const armed = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /\b(setInterval|setImmediate)\s*\(/.test(readFileSync(join(dir, f), "utf8")));
    assert.deepEqual(armed, [], "a clock that calls a model spends while we sleep");
  });
});

describe("first launch: no call, and the reason is given", () => {
  it("an empty control plane costs no model call", async () => {
    const { calls, run } = counter();
    const brief = await conciergeBrief({}, { run, context: () => EMPTY, now: () => NOW });
    assert.equal(calls.length, 0);
    assert.equal(brief.reason, "nothing-to-tell");
    assert.deepEqual(brief.items, []);
  });

  it("hasSomethingToTell is true as soon as one thing moved", () => {
    assert.equal(hasSomethingToTell(EMPTY), false);
    assert.equal(hasSomethingToTell(FULL), true);
    assert.equal(
      hasSomethingToTell({
        ...EMPTY,
        sessions: [
          {
            taskName: "t",
            agentName: "a",
            status: "running",
            model: "haiku",
            costUsd: null,
            startedAt: NOW,
            endedAt: null,
          },
        ],
      }),
      true,
    );
  });
});

describe("parseBrief: triage, and links the agent does not build", () => {
  const known = new Map([
    ["tk09", "Legion"],
    ["tk10", "Koala"],
  ]);

  it("returns prose and triaged lines, with the cited task's project", () => {
    const { prose, items } = parseBrief(REPLY, known);
    assert.deepEqual(prose, ["Three sessions running, all on Legion."]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.severity, "now");
    assert.equal(items[0]?.taskId, "tk09");
    assert.equal(items[0]?.projectId, "Legion");
  });

  it("accepts JSON wrapped in a code block or after a sentence", () => {
    const wrapped = "Here is the report:\n```json\n" + REPLY + "\n```";
    assert.equal(parseBrief(wrapped, known).items.length, 1);
  });

  it("drops the link of an id the context did not carry, not its sentence", () => {
    const raw = JSON.stringify({
      prose: ["p"],
      items: [{ severity: "now", text: "it is stuck", task: "tk-made-up" }],
    });
    const items = parseBrief(raw, known).items;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.taskId, null);
  });

  it("accepts `task=tk09` as well as `tk09`: the prompt writes the prefixed form", () => {
    const raw = JSON.stringify({
      prose: ["p"],
      items: [{ severity: "soon", text: "t", task: "task=tk10" }],
    });
    assert.equal(parseBrief(raw, known).items[0]?.taskId, "tk10");
  });

  it("drops an unknown level to `fyi` instead of losing the line", () => {
    const raw = JSON.stringify({
      prose: ["p"],
      items: [{ severity: "URGENT!!", text: "t", task: null }],
    });
    assert.equal(parseBrief(raw, known).items[0]?.severity, "fyi");
  });

  it("discards a line without text", () => {
    const raw = JSON.stringify({
      prose: ["p"],
      items: [{ severity: "now", text: "  " }, 42, null],
    });
    assert.deepEqual(parseBrief(raw, known).items, []);
  });

  it("keeps a non-JSON answer readable: the page is never empty", () => {
    const { prose, items } = parseBrief("Three sessions running.\n\nNothing is blocked.", known);
    assert.deepEqual(prose, ["Three sessions running.", "Nothing is blocked."]);
    assert.deepEqual(items, []);
  });
});

describe("situation report prompt", () => {
  it("carries the compiled context and the expected format", () => {
    const prompt = buildBriefPrompt(FULL);
    assert.match(prompt, /task=tk09/);
    assert.match(prompt, /"severity": "now\|soon\|fyi"/);
  });

  it("the system prompt asks for sentences and restates read-only", () => {
    assert.match(BRIEF_SYSTEM_PROMPT, /READ-ONLY/);
    assert.match(BRIEF_SYSTEM_PROMPT, /SENTENCES/);
  });
});
