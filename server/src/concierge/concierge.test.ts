// Above all this file protects "the concierge cannot modify a task". The guarantee is tested, not
// just obtained by omitting tools: the tests call the real `canUseTool` callback with real write
// tool names (mcp__legion__update_task, Write, Bash…), as an SDK bridge would by mistake.
//
// Since 13/09 the concierge has three reads, so "no tool" became "these three and nothing else":
// `allowOnly` guards the conversation, the situation report keeps the total refusal, and
// `allowedTools` is compared by equality so a fourth tool granted quietly fails the test. `query`
// is a fake generator, as in task-classify.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowOnly,
  askConcierge,
  CONCIERGE_DISALLOWED_TOOLS,
  denyAllTools,
  runConciergeQuery,
  type ConciergeDeps,
} from "./concierge.js";
import { CONCIERGE_TOOL_NAMES } from "./concierge-tools.js";
import type { ConciergeContextData } from "./concierge-context.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";

const CONTEXT: ConciergeContextData = {
  generatedAt: 1_700_000_000_000,
  tasks: [],
  sessions: [],
  pendingQuestions: [],
  cost: { windowDays: 7, totalUsd: 0, runningCount: 0 },
};

type CapturedOptions = Record<string, unknown> & {
  canUseTool?: (
    name: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal },
  ) => Promise<unknown>;
};

/** Fake SDK `Query` and what it saw: the options `askConcierge` passed and the `interrupt()`
 *  call count. */
interface QuerySpy {
  query: ConciergeDeps["query"];
  options?: CapturedOptions;
  interrupts: number;
}

/** Same contract as `fakeQuery` in task-classify.test.ts: async generator plus a traceable
 *  `interrupt()`. */
function fakeQuery(
  behavior: (() => Promise<{ type: string; subtype?: string; result?: string }>) | "hang" | "throw",
): QuerySpy {
  const spy: QuerySpy = {
    interrupts: 0,
    query: ((args: { prompt: string; options: CapturedOptions }) => {
      spy.options = args.options;
      async function* gen() {
        if (behavior === "hang") {
          await new Promise(() => {});
          return;
        }
        if (behavior === "throw") throw new Error("SDK failure");
        yield await behavior();
      }
      const it = gen() as AsyncGenerator<
        { type: string; subtype?: string; result?: string },
        void
      > & { interrupt: () => Promise<void> };
      it.interrupt = async () => {
        spy.interrupts += 1;
      };
      return it;
    }) as unknown as ConciergeDeps["query"],
  };
  return spy;
}

/** Silent tool queries: this file tests the wiring (which tools enter the session, which are
 *  refused); `concierge-tools.test.ts` tests what they return. */
const SILENT_STORE: ConciergeDeps["toolsStore"] = {
  taskWithProject: () => null,
  sessionsOfTask: () => [],
  eventsOfSessions: () => [],
  searchTasks: () => [],
};

function deps(overrides: Partial<ConciergeDeps> = {}): ConciergeDeps {
  return {
    query: fakeQuery("throw").query,
    credentialEnvFor: () => ({ env: {} }),
    timeoutMs: 3000,
    model: "haiku",
    toolsStore: SILENT_STORE,
    ...overrides,
  };
}

describe("denyAllTools, the guarantee tested rather than promised", () => {
  const NOOP_SIGNAL = {
    signal: new AbortController().signal,
    toolUseID: "test-tool-use",
    requestId: "test-request",
  };

  it("refuses an internal MCP write tool (mcp__legion__update_task)", async () => {
    const verdict = await denyAllTools(
      "mcp__legion__update_task",
      { status: TASK_STATUS.done },
      NOOP_SIGNAL,
    );
    assert.equal(verdict?.behavior, "deny");
  });

  it("refuses an fs write tool (mcp__legion__fs_write)", async () => {
    const verdict = await denyAllTools(
      "mcp__legion__fs_write",
      { path: "x", content: "y" },
      NOOP_SIGNAL,
    );
    assert.equal(verdict?.behavior, "deny");
  });

  it("refuses base SDK tools (Write, Bash)", async () => {
    for (const name of ["Write", "Bash", "Edit"]) {
      const verdict = await denyAllTools(name, {}, NOOP_SIGNAL);
      assert.equal(verdict?.behavior, "deny", name);
    }
  });

  it("refuses even an unknown tool name: a total refusal", async () => {
    const verdict = await denyAllTools("a-tool-that-does-not-exist", {}, NOOP_SIGNAL);
    assert.equal(verdict?.behavior, "deny");
  });

  it("interrupts the session, not just the call", async () => {
    const verdict = await denyAllTools("mcp__legion__update_task", {}, NOOP_SIGNAL);
    assert.equal((verdict as { interrupt?: boolean }).interrupt, true);
  });

  it("names the refused tool in the message", async () => {
    const verdict = await denyAllTools("mcp__legion__update_task", {}, NOOP_SIGNAL);
    assert.match((verdict as { message: string }).message, /mcp__legion__update_task/);
  });
});

// The same guarantee since it has tools (13/09): `allowOnly` still refuses by default and accepts
// three names.
describe("allowOnly, refusal stays the default and three doors are open", () => {
  const NOOP_SIGNAL = {
    signal: new AbortController().signal,
    toolUseID: "test-tool-use",
    requestId: "test-request",
  };
  const guard = allowOnly(CONCIERGE_TOOL_NAMES);

  it("accepts the concierge's three reads and passes the input through", async () => {
    for (const name of CONCIERGE_TOOL_NAMES) {
      const verdict = await guard(name, { taskId: "AWCsGxmP7i" }, NOOP_SIGNAL);
      assert.equal(verdict?.behavior, "allow", name);
      assert.deepEqual(
        (verdict as { updatedInput: unknown }).updatedInput,
        { taskId: "AWCsGxmP7i" },
        "this guard decides which tool, never with what",
      );
    }
  });

  it("refuses the runtime's write tools, which the concierge never received", async () => {
    for (const name of [
      "mcp__legion__update_task",
      "mcp__legion__fs_write",
      "mcp__legion__inbox_send",
      "Write",
      "Bash",
    ]) {
      const verdict = await guard(name, {}, NOOP_SIGNAL);
      assert.equal(verdict?.behavior, "deny", name);
    }
  });

  it("refuses an unknown name: an allow-list, not a deny-list", async () => {
    const verdict = await guard("mcp__legion__delete_everything", {}, NOOP_SIGNAL);
    assert.equal(verdict?.behavior, "deny");
  });

  it("interrupts the session and names the tool", async () => {
    const verdict = await guard("mcp__legion__update_task", {}, NOOP_SIGNAL);
    assert.equal((verdict as { interrupt?: boolean }).interrupt, true);
    assert.match((verdict as { message: string }).message, /mcp__legion__update_task/);
  });
});

describe("askConcierge, options sent to the SDK", () => {
  it("grants only its three reads: empty SDK base, allowedTools exactly CONCIERGE_TOOL_NAMES", async () => {
    const spy = fakeQuery(async () => ({
      type: "result",
      subtype: "success",
      result: "nothing new",
    }));
    await askConcierge(
      { message: "what's new?", history: [] },
      CONTEXT,
      deps({ query: spy.query }),
    );
    assert.deepEqual(spy.options?.tools, [], "no base SDK tool: no Bash, Read or Write");
    // Equality, not inclusion: one more tool must fail this test, so a write tool cannot be
    // granted without saying so.
    assert.deepEqual(spy.options?.allowedTools, [...CONCIERGE_TOOL_NAMES]);
    assert.deepEqual(
      spy.options?.settingSources,
      [],
      "no repository .claude/settings.json may add itself",
    );
    assert.equal(typeof spy.options?.canUseTool, "function");
  });

  it("mounts one in-process MCP server named `legion`, nothing else", async () => {
    const spy = fakeQuery(async () => ({ type: "result", subtype: "success", result: "ok" }));
    await askConcierge({ message: "m", history: [] }, CONTEXT, deps({ query: spy.query }));
    const servers = spy.options?.mcpServers as Record<string, unknown> | undefined;
    assert.deepEqual(Object.keys(servers ?? {}), ["legion"]);
  });

  it("keeps the situation report without tools", async () => {
    const spy = fakeQuery(async () => ({ type: "result", subtype: "success", result: "ok" }));
    await runConciergeQuery("prompt", "system", deps({ query: spy.query }));
    assert.deepEqual(spy.options?.allowedTools, []);
    assert.equal(spy.options?.mcpServers, undefined);
    assert.equal(spy.options?.maxTurns, 1);
  });

  it("the second belt (disallowedTools) covers every tool the app knows", async () => {
    const spy = fakeQuery(async () => ({ type: "result", subtype: "success", result: "ok" }));
    await askConcierge({ message: "m", history: [] }, CONTEXT, deps({ query: spy.query }));
    const disallowed = new Set(spy.options?.disallowedTools as string[]);
    for (const t of CONCIERGE_DISALLOWED_TOOLS) assert.ok(disallowed.has(t), t);
    assert.ok(disallowed.has("mcp__legion__update_task"));
    assert.ok(disallowed.has("mcp__legion__inbox_send"));
    assert.ok(disallowed.has("Write"));
  });

  it("calls credentialEnvFor without a projectId: the concierge belongs to no project", async () => {
    let calledWith: unknown[] | undefined;
    await askConcierge(
      { message: "m", history: [] },
      CONTEXT,
      deps({
        query: fakeQuery(async () => ({ type: "result", subtype: "success", result: "ok" })).query,
        credentialEnvFor: (...args: unknown[]) => {
          calledWith = args;
          return { env: {} };
        },
      }),
    );
    assert.deepEqual(calledWith, []);
  });
});

describe("askConcierge, success", () => {
  it("returns the text of the successful `result` message", async () => {
    const result = await askConcierge(
      { message: "what's new?", history: [] },
      CONTEXT,
      deps({
        query: fakeQuery(async () => ({
          type: "result",
          subtype: "success",
          result: "**nothing** new",
        })).query,
      }),
    );
    assert.deepEqual(result, { ok: true, reply: "**nothing** new" });
  });

  it("always calls interrupt(), success included: no session left open", async () => {
    const spy = fakeQuery(async () => ({ type: "result", subtype: "success", result: "ok" }));
    await askConcierge({ message: "m", history: [] }, CONTEXT, deps({ query: spy.query }));
    assert.equal(spy.interrupts, 1);
  });
});

describe("askConcierge, errors never escape as exceptions", () => {
  it("timeout: ok=false, status 504, interrupt() cuts the lingering query", async () => {
    const spy = fakeQuery("hang");
    const result = await askConcierge(
      { message: "m", history: [] },
      CONTEXT,
      deps({ query: spy.query, timeoutMs: 20 }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 504);
      assert.match(result.error, /timed out/);
    }
    assert.equal(spy.interrupts, 1);
  });

  it("SDK failure: ok=false, status 502", async () => {
    const result = await askConcierge(
      { message: "m", history: [] },
      CONTEXT,
      deps({ query: fakeQuery("throw").query }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 502);
  });

  it("turn cut by the model (failure subtype): ok=false, status 502", async () => {
    const result = await askConcierge(
      { message: "m", history: [] },
      CONTEXT,
      deps({
        query: fakeQuery(async () => ({ type: "result", subtype: "error_max_turns" })).query,
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 502);
  });

  it("no result message at all: ok=false rather than a silent endless wait", async () => {
    const query = (() => {
      async function* gen() {
        /* nothing */
      }
      const it = gen() as AsyncGenerator<{ type: string }, void> & {
        interrupt: () => Promise<void>;
      };
      it.interrupt = async () => {};
      return it;
    }) as unknown as ConciergeDeps["query"];
    const result = await askConcierge({ message: "m", history: [] }, CONTEXT, deps({ query }));
    assert.equal(result.ok, false);
  });
});
