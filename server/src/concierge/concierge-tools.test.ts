// Protects the formatting of tool answers, the only thing that can be wrong here (SDK wiring is in
// `concierge.test.ts`). No database, no SDK: a fake `tool` that records declarations, and
// hand-made rows.
//
// Two facts matter most: a trace reads in time order although the query pulls it reversed, and a
// payload is cut, since twenty raw events would fill the window.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import {
  buildConciergeTools,
  CONCIERGE_TOOL_NAMES,
  formatSearchResults,
  formatTaskDetail,
  formatTimeline,
  type ConciergeToolsStore,
} from "./concierge-tools.js";
import type {
  SessionEventRow,
  SessionRow,
  TaskRow,
  TaskWithProject,
} from "./concierge-tools-store.js";

const AT = new Date("2026-09-08T17:22:00.000Z");

function task(over: Partial<TaskRow> = {}): TaskWithProject {
  return {
    projectName: "legion",
    task: {
      id: "AWCsGxmP7i",
      projectId: "rN0_3r99mj",
      name: "Infra: rebuild a missing image in one click",
      description: "",
      status: "doing",
      settledOutcome: null,
      boardOrder: 0,
      createdAt: AT,
      updatedAt: AT,
      ...over,
    } as TaskRow,
  };
}

function session(over: Partial<SessionRow> = {}): { session: SessionRow; agentName: string } {
  return {
    agentName: "server",
    session: {
      id: "sess1",
      taskId: "AWCsGxmP7i",
      model: "sonnet",
      status: "failed",
      costUsd: 0.42,
      startedAt: AT,
      endedAt: AT,
      endReason: "image missing",
      ...over,
    } as SessionRow,
  };
}

function event(over: Partial<SessionEventRow> = {}): SessionEventRow {
  return {
    id: 1,
    sessionId: "sess1",
    seq: 1,
    type: "run_error",
    payload: '{"message":"boom"}',
    createdAt: AT,
    ...over,
  } as SessionEventRow;
}

describe("formatTaskDetail", () => {
  it("names the task, its project and its id in the form the prompt can cite", () => {
    const out = formatTaskDetail(task(), []);
    assert.match(out, /task=AWCsGxmP7i/);
    assert.match(out, /\[legion\]/);
  });

  it("says no session ran instead of returning an empty list", () => {
    assert.match(formatTaskDetail(task(), []), /sessions: none/);
  });

  it("returns each session's cost, end reason and agent", () => {
    const out = formatTaskDetail(task(), [session()]);
    assert.match(out, /session=sess1/);
    assert.match(out, /\$0\.42/);
    assert.match(out, /image missing/);
    assert.match(out, /server/);
  });

  it("says an unknown cost is unknown instead of showing zero", () => {
    const out = formatTaskDetail(task(), [session({ costUsd: null })]);
    assert.match(out, /unknown cost/);
    assert.doesNotMatch(out, /\$0\.00/);
  });

  it("gives an automatically settled task's outcome, which is not its status", () => {
    const out = formatTaskDetail(task({ settledOutcome: "failed" }), []);
    assert.match(out, /settled: failed/);
  });
});

describe("formatTimeline", () => {
  it("renders oldest first, although the query pulls newest first", () => {
    const out = formatTimeline(
      [event({ id: 2, payload: '{"m":"second"}' }), event({ id: 1, payload: '{"m":"first"}' })],
      false,
    );
    assert.ok(out.indexOf("first") < out.indexOf("second"), out);
  });

  it("cuts a huge payload", () => {
    const out = formatTimeline([event({ payload: "x".repeat(5000) })], false);
    assert.ok(out.length < 1000, `${out.length} characters`);
    assert.match(out, /…$/);
  });

  it("flattens newlines: one line per event, or timestamps no longer delimit anything", () => {
    const out = formatTimeline([event({ payload: "a\n\nb\nc" })], false);
    assert.equal(out.split("\n").length, 1);
  });

  it("writes the type in brackets, which tells an error from speech", () => {
    assert.match(formatTimeline([event({ type: "run_error" })], false), /\[run_error\]/);
  });

  it("when empty and filtered, says how to see the rest; when empty and complete, does not", () => {
    assert.match(formatTimeline([], false), /all=true/);
    assert.doesNotMatch(formatTimeline([], true), /all=true/);
  });
});

describe("formatSearchResults", () => {
  it("says nothing was found instead of returning an empty string", () => {
    assert.match(formatSearchResults([]), /no task matches/);
  });

  it("cites each task as task=<id>, which the model can reuse as input", () => {
    assert.match(formatSearchResults([task()]), /- task=AWCsGxmP7i \[legion\]/);
  });
});

describe("buildConciergeTools, wiring of the three tools", () => {
  /** What a handler receives after the SDK applied the zod schema: an arbitrary object. The fake
   *  `tool` validates nothing; what is tested is what the handler does with its input. */
  type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
  type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

  const declared: { name: string; run: Handler }[] = [];
  const fakeTool = ((name: string, _description: string, _schema: unknown, handler: Handler) => {
    declared.push({ name, run: handler });
    return { name, handler };
  }) as Parameters<typeof buildConciergeTools>[0]["tool"];

  function build(store: Partial<ConciergeToolsStore> = {}) {
    declared.length = 0;
    buildConciergeTools(
      { tool: fakeTool },
      {
        taskWithProject: () => null,
        sessionsOfTask: () => [],
        eventsOfSessions: () => [],
        searchTasks: () => [],
        ...store,
      },
    );
    return (name: string) => declared.find((d) => d.name === name)!.run;
  }

  const textOf = (r: { content: { type: string; text?: string }[] }) => r.content[0]?.text ?? "";

  it("declares exactly the tools CONCIERGE_TOOL_NAMES announces to the SDK", () => {
    build();
    // `canUseTool` sees names prefixed by the MCP server, declared ones are not: a tool declared
    // but not announced (or the reverse) fails this test.
    assert.deepEqual(
      declared.map((d) => `mcp__legion__${d.name}`),
      [...CONCIERGE_TOOL_NAMES],
    );
  });

  it("task_detail returns a sentence for an unknown id, never a tool error", async () => {
    const run = build()("task_detail");
    assert.match(textOf(await run({ taskId: "doesnotexist" }, {})), /no task doesnotexist/);
  });

  it("task_timeline tells an unknown task from one that never ran", async () => {
    const unknown = build()("task_timeline");
    assert.match(textOf(await unknown({ taskId: "zz" }, {})), /no task zz/);

    const neverRan = build({ taskWithProject: () => task() })("task_timeline");
    assert.match(textOf(await neverRan({ taskId: "AWCsGxmP7i" }, {})), /has never run/);
  });

  it("task_timeline filters by default and returns everything on all=true", async () => {
    let askedTypes: string[] = ["sentinel"];
    const run = build({
      taskWithProject: () => task(),
      sessionsOfTask: () => [session()],
      eventsOfSessions: (_ids, types) => {
        askedTypes = types;
        return [event()];
      },
    })("task_timeline");

    await run({ taskId: "AWCsGxmP7i" }, {});
    assert.ok(askedTypes.includes("run_error"), "the default keeps what explains an outcome");

    await run({ taskId: "AWCsGxmP7i", all: true }, {});
    assert.deepEqual(askedTypes, [], "all=true filters nothing");
  });

  it("task_timeline caps the event count even when asked for a thousand", async () => {
    let asked = -1;
    const run = build({
      taskWithProject: () => task(),
      sessionsOfTask: () => [session()],
      eventsOfSessions: (_ids, _types, limit) => {
        asked = limit;
        return [];
      },
    })("task_timeline");
    await run({ taskId: "AWCsGxmP7i", limit: 1000 }, {});
    assert.ok(asked > 0 && asked <= 40, `cap ignored: ${asked}`);
  });

  it("search_tasks turns missing fields into null: the store never gets undefined", async () => {
    let seen: unknown;
    const run = build({
      searchTasks: (opts) => {
        seen = opts;
        return [];
      },
    })("search_tasks");
    await run({ text: "image" }, {});
    assert.deepEqual(seen, { text: "image", status: null, projectId: null, limit: 30 });
  });
});
