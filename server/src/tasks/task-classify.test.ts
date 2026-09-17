// What this file protects:
//
//  1. a successful classification (mocked SDK) resolves the name the model returned to the real id,
//     agent or chain, rather than trusting an id the model could hallucinate;
//  2. a timeout (~3 s) returns the composer's current defaults with reason="repli" (the value the
//     code still returns), never an exception blocking task creation;
//  3. a project with neither agent nor catalogue chain short-circuits the SDK call and falls back at
//     once; a project with chains but no agent still tries classification;
//  4. a hallucinated name (absent from the given lists) or out-of-schema output also fall back;
//  5. `interrupt()` is always called, on success, fallback or timeout alike: no SDK session left
//     open.
//
// All dependencies (query, credentialEnvFor) are injected: no real SDK, database or network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTask,
  type ClassifyAgent,
  type ClassifyChain,
  type ClassifyDeps,
} from "./task-classify.js";
import { COMPLEXITY } from "./task-scales.js";
import { BRANCH_TYPE } from "./task-branch.js";

const AGENTS: ClassifyAgent[] = [
  { id: "a1", name: "spec", title: "Writes specs", rolePrompt: "You write specs." },
  { id: "a2", name: "senior-dev", title: "Implements", rolePrompt: "You implement." },
];
const CHAINS: ClassifyChain[] = [
  { id: "c1", name: "compound-engineer", description: "spec → plan → implement → review" },
];

/** Builds a fake SDK `Query`: an async generator yielding one `result` message, plus a traceable
 *  `interrupt()`; same contract as `Query` (sdk.d.ts: `AsyncGenerator<SDKMessage>` +
 *  `interrupt()`). */
function fakeQuery(
  behavior:
    | (() => Promise<{ type: string; subtype?: string; structured_output?: unknown }>)
    | "hang"
    | "throw",
  interruptCalls: { count: number },
) {
  // The counter belongs to the caller: mutate it through a local alias rather than the parameter.
  const calls = interruptCalls;
  return (() => {
    async function* gen() {
      if (behavior === "hang") {
        await new Promise(() => {}); // never resolves: forces the timeout
        return;
      }
      if (behavior === "throw") throw new Error("SDK failure");
      yield await behavior();
    }
    const it = gen() as AsyncGenerator<
      { type: string; subtype?: string; structured_output?: unknown },
      void
    > & { interrupt: () => Promise<void> };
    it.interrupt = async () => {
      calls.count += 1;
    };
    return it;
  }) as unknown as ClassifyDeps["query"];
}

function deps(overrides: Partial<ClassifyDeps> = {}): ClassifyDeps {
  return {
    query: fakeQuery("throw", { count: 0 }),
    credentialEnvFor: () => ({ env: {} }),
    timeoutMs: 3000,
    ...overrides,
  };
}

describe("classifyTask: success", () => {
  it("resolves a proposed agent by its name to its real id", async () => {
    const interruptCalls = { count: 0 };
    const result = await classifyTask(
      { name: "Fix the dead footer link", description: "", agents: AGENTS, chains: CHAINS },
      deps({
        query: fakeQuery(
          async () => ({
            type: "result",
            subtype: "success",
            structured_output: {
              kind: "agent",
              name: "senior-dev",
              complexity: COMPLEXITY.low,
              gate: false,
              type: BRANCH_TYPE.bugfix,
              reason: "simple touch-up",
            },
          }),
          interruptCalls,
        ),
      }),
    );
    assert.deepEqual(result, {
      kind: "agent",
      agentId: "a2",
      templateId: null,
      complexity: COMPLEXITY.low,
      gate: false,
      type: BRANCH_TYPE.bugfix,
      reason: "simple touch-up",
    });
    assert.equal(interruptCalls.count, 1, "interrupt() must be called even on success");
  });

  it("resolves a proposed chain by its name to its catalogue id", async () => {
    const result = await classifyTask(
      {
        name: "Rework the payment module",
        description: "big job, several risks",
        agents: AGENTS,
        chains: CHAINS,
      },
      deps({
        query: fakeQuery(
          async () => ({
            type: "result",
            subtype: "success",
            structured_output: {
              kind: "chain",
              name: "compound-engineer",
              complexity: COMPLEXITY.high,
              gate: true,
              type: BRANCH_TYPE.feature,
              reason: "multi-step job",
            },
          }),
          { count: 0 },
        ),
      }),
    );
    assert.deepEqual(result, {
      kind: "chain",
      agentId: null,
      templateId: "c1",
      complexity: COMPLEXITY.high,
      gate: true,
      type: BRANCH_TYPE.feature,
      reason: "multi-step job",
    });
  });
});

describe("classifyTask: fallback", () => {
  it("empty title: immediate fallback, no SDK call", async () => {
    const query = (() => {
      throw new Error("should not be called");
    }) as unknown as ClassifyDeps["query"];
    const result = await classifyTask(
      { name: "   ", description: "", agents: AGENTS, chains: CHAINS },
      deps({ query }),
    );
    assert.deepEqual(result, {
      kind: "agent",
      agentId: "a1",
      templateId: null,
      complexity: COMPLEXITY.med,
      gate: false,
      type: BRANCH_TYPE.chore,
      reason: "repli",
    });
  });

  it("project with neither agent nor chain: immediate fallback, no SDK call", async () => {
    const query = (() => {
      throw new Error("should not be called");
    }) as unknown as ClassifyDeps["query"];
    const result = await classifyTask(
      { name: "A task", description: "", agents: [], chains: [] },
      deps({ query }),
    );
    assert.deepEqual(result, {
      kind: "agent",
      agentId: null,
      templateId: null,
      complexity: COMPLEXITY.med,
      gate: false,
      type: BRANCH_TYPE.chore,
      reason: "repli",
    });
  });

  it("project without agents but with chains: classification is still attempted", async () => {
    const interruptCalls = { count: 0 };
    const result = await classifyTask(
      { name: "Big job", description: "", agents: [], chains: CHAINS },
      deps({
        query: fakeQuery(
          async () => ({
            type: "result",
            subtype: "success",
            structured_output: {
              kind: "chain",
              name: "compound-engineer",
              complexity: COMPLEXITY.high,
              gate: true,
              type: BRANCH_TYPE.feature,
              reason: "only viable option",
            },
          }),
          interruptCalls,
        ),
      }),
    );
    assert.equal(result.kind, "chain");
    assert.equal(result.templateId, "c1");
    assert.equal(interruptCalls.count, 1);
  });

  it('timeout (~3 s): fallback with reason="repli", never an exception', async () => {
    const interruptCalls = { count: 0 };
    const result = await classifyTask(
      { name: "A task", description: "", agents: AGENTS, chains: CHAINS },
      deps({ query: fakeQuery("hang", interruptCalls), timeoutMs: 20 }),
    );
    assert.deepEqual(result, {
      kind: "agent",
      agentId: "a1",
      templateId: null,
      complexity: COMPLEXITY.med,
      gate: false,
      type: BRANCH_TYPE.chore,
      reason: "repli",
    });
    assert.equal(interruptCalls.count, 1, "interrupt() must cut the lingering request");
  });

  it("SDK failure: fallback, never a propagating exception", async () => {
    const interruptCalls = { count: 0 };
    const result = await classifyTask(
      { name: "A task", description: "", agents: AGENTS, chains: CHAINS },
      deps({ query: fakeQuery("throw", interruptCalls) }),
    );
    assert.equal(result.reason, "repli");
    assert.equal(interruptCalls.count, 1);
  });

  it("hallucinated name (absent from the given list): fallback rather than guessing", async () => {
    const result = await classifyTask(
      { name: "A task", description: "", agents: AGENTS, chains: CHAINS },
      deps({
        query: fakeQuery(
          async () => ({
            type: "result",
            subtype: "success",
            structured_output: {
              kind: "agent",
              name: "agent-that-does-not-exist",
              complexity: COMPLEXITY.med,
              gate: false,
              reason: "…",
            },
          }),
          { count: 0 },
        ),
      }),
    );
    assert.equal(result.reason, "repli");
    assert.equal(result.agentId, "a1"); // fallback = the project's first agent, like the composer today
  });

  it("out-of-schema output (missing kind): fallback rather than an exception", async () => {
    const result = await classifyTask(
      { name: "A task", description: "", agents: AGENTS, chains: CHAINS },
      deps({
        query: fakeQuery(
          async () => ({
            type: "result",
            subtype: "success",
            structured_output: { name: "senior-dev" },
          }),
          { count: 0 },
        ),
      }),
    );
    assert.equal(result.reason, "repli");
  });

  it("no successful `result` message (e.g. execution error): fallback", async () => {
    const result = await classifyTask(
      { name: "A task", description: "", agents: AGENTS, chains: CHAINS },
      deps({
        query: fakeQuery(async () => ({ type: "result", subtype: "error_during_execution" }), {
          count: 0,
        }),
      }),
    );
    assert.equal(result.reason, "repli");
  });
});

describe("classifyTask: pins (the hand is a constraint, never dismissed)", () => {
  // `type` (v50) is set by default: these tests are about pins, and output without `type` is out of
  // schema, which would fall back entirely and mask what they check.
  const ok = (out: object) => async () => ({
    type: "result",
    subtype: "success",
    structured_output: { type: BRANCH_TYPE.chore, ...out },
  });

  it("the pinned agent survives even if the model proposes another", async () => {
    const interruptCalls = { count: 0 };
    const r = await classifyTask(
      { name: "t", description: "", agents: AGENTS, chains: CHAINS, forced: { agentId: "a1" } },
      deps({
        query: fakeQuery(
          ok({
            kind: "agent",
            name: "senior-dev",
            complexity: COMPLEXITY.high,
            gate: true,
            reason: "ignoring the instruction",
          }),
          interruptCalls,
        ),
      }),
    );
    assert.equal(r.agentId, "a1", "the pin wins over the model's answer");
    assert.equal(r.kind, "agent");
    assert.equal(r.complexity, "high", "unpinned fields come from the model");
    assert.equal(r.gate, true);
  });

  it("pinned complexity and gate survive the model's answer", async () => {
    const interruptCalls = { count: 0 };
    const r = await classifyTask(
      {
        name: "t",
        description: "",
        agents: AGENTS,
        chains: CHAINS,
        forced: { complexity: COMPLEXITY.low, gate: false },
      },
      deps({
        query: fakeQuery(
          ok({
            kind: "agent",
            name: "senior-dev",
            complexity: COMPLEXITY.high,
            gate: true,
            reason: "r",
          }),
          interruptCalls,
        ),
      }),
    );
    assert.equal(r.agentId, "a2", "the unpinned field comes from the model");
    assert.equal(r.complexity, "low");
    assert.equal(r.gate, false);
  });

  it("everything pinned (agent + complexity + gate): no SDK call, reason set by hand", async () => {
    let called = 0;
    const spyQuery = ((...args: unknown[]) => {
      called += 1;
      void args;
      throw new Error("must not be called");
    }) as unknown as ClassifyDeps["query"];
    const r = await classifyTask(
      {
        name: "t",
        description: "",
        agents: AGENTS,
        chains: CHAINS,
        forced: { agentId: "a1", complexity: COMPLEXITY.med, gate: true },
      },
      deps({ query: spyQuery }),
    );
    assert.equal(called, 0);
    assert.equal(r.agentId, "a1");
    assert.equal(r.gate, true);
    assert.equal(r.reason, "set by hand");
  });

  it("a pinned chain has nothing to propose: no SDK call", async () => {
    let called = 0;
    const spyQuery = ((...args: unknown[]) => {
      called += 1;
      void args;
      throw new Error("must not be called");
    }) as unknown as ClassifyDeps["query"];
    const r = await classifyTask(
      { name: "t", description: "", agents: AGENTS, chains: CHAINS, forced: { templateId: "c1" } },
      deps({ query: spyQuery }),
    );
    assert.equal(called, 0);
    assert.equal(r.kind, "chain");
    assert.equal(r.templateId, "c1");
  });

  it("pins survive the fallback (SDK failure)", async () => {
    const r = await classifyTask(
      {
        name: "t",
        description: "",
        agents: AGENTS,
        chains: CHAINS,
        forced: { agentId: "a2", gate: true },
      },
      deps(), // query "throw"
    );
    assert.equal(r.reason, "repli");
    assert.equal(r.agentId, "a2", "a failure does not take control back");
    assert.equal(r.gate, true);
  });

  it("a pin to a vanished agent is ignored (we do not pin a ghost)", async () => {
    const interruptCalls = { count: 0 };
    const r = await classifyTask(
      {
        name: "t",
        description: "",
        agents: AGENTS,
        chains: CHAINS,
        forced: { agentId: "a-ghost" },
      },
      deps({
        query: fakeQuery(
          ok({ kind: "agent", name: "spec", complexity: COMPLEXITY.med, gate: false, reason: "r" }),
          interruptCalls,
        ),
      }),
    );
    assert.equal(r.agentId, "a1", "normal resolution, the dead pin forced nothing");
  });
});

// v50: the work type (conventionalbranch.org), naming the branch. It gets no special treatment: it
// falls into the existing fallback, like complexity and gate. What matters is not that it is right
// but that no task creation can fail because of it, hence the sweep of every fallback path.
describe("classifyTask: the branch type", () => {
  const structured = (out: object) => async () => ({
    type: "result",
    subtype: "success",
    structured_output: out,
  });

  // The model reads the prompt, not the code: an enum's name there is a word it has no use for.
  it("names the branch types by value in the prompt, never by enum name", async () => {
    let sent = "";
    const inner = fakeQuery("throw", { count: 0 });
    const spy = ((args: { prompt: string }) => {
      sent = args.prompt;
      return inner(args as never);
    }) as unknown as ClassifyDeps["query"];
    await classifyTask(
      { name: "t", description: "", agents: AGENTS, chains: CHAINS },
      deps({ query: spy }),
    );
    assert.doesNotMatch(sent, /BRANCH_TYPE\./);
    for (const type of [BRANCH_TYPE.feature, BRANCH_TYPE.bugfix, BRANCH_TYPE.chore]) {
      assert.match(sent, new RegExp(`"${type}"`));
    }
  });

  it("takes the model's proposed type when it is in the schema", async () => {
    for (const type of [BRANCH_TYPE.feature, BRANCH_TYPE.bugfix, BRANCH_TYPE.chore]) {
      const r = await classifyTask(
        { name: "t", description: "", agents: AGENTS, chains: CHAINS },
        deps({
          query: fakeQuery(
            structured({
              kind: "agent",
              name: "spec",
              complexity: COMPLEXITY.med,
              gate: false,
              type,
              reason: "r",
            }),
            { count: 0 },
          ),
        }),
      );
      assert.equal(r.type, type);
    }
  });

  it("every fallback path returns `chore`", async () => {
    const repli: [string, ClassifyDeps][] = [
      ["SDK failure", deps({ query: fakeQuery("throw", { count: 0 }) })],
      ["timeout", deps({ query: fakeQuery("hang", { count: 0 }), timeoutMs: 20 })],
      [
        "out-of-schema output",
        deps({ query: fakeQuery(structured({ name: "spec" }), { count: 0 }) }),
      ],
      [
        "hallucinated name",
        deps({
          query: fakeQuery(
            structured({
              kind: "agent",
              name: "ghost",
              complexity: COMPLEXITY.med,
              gate: false,
              type: BRANCH_TYPE.feature,
              reason: "r",
            }),
            { count: 0 },
          ),
        }),
      ],
    ];
    for (const [label, d] of repli) {
      const r = await classifyTask(
        { name: "t", description: "", agents: AGENTS, chains: CHAINS },
        d,
      );
      assert.equal(r.type, BRANCH_TYPE.chore, `${label}: the fallback must return chore`);
    }
  });

  it("a type invented by the model is out-of-schema output: fallback, not an unknown value in the database", async () => {
    // `hotfix` exists in the spec but not in this repository, and the column does not carry it.
    // Letting it through would write a value Drizzle reads back as one of the three types.
    const r = await classifyTask(
      { name: "t", description: "", agents: AGENTS, chains: CHAINS },
      deps({
        query: fakeQuery(
          structured({
            kind: "agent",
            name: "spec",
            complexity: COMPLEXITY.med,
            gate: false,
            type: "hotfix",
            reason: "r",
          }),
          { count: 0 },
        ),
      }),
    );
    assert.equal(r.type, BRANCH_TYPE.chore);
    assert.equal(r.reason, "repli");
  });

  it("empty title and project without agents (both short-circuits) return `chore` too", async () => {
    const query = (() => {
      throw new Error("should not be called");
    }) as unknown as ClassifyDeps["query"];
    assert.equal(
      (
        await classifyTask(
          { name: "  ", description: "", agents: AGENTS, chains: CHAINS },
          deps({ query }),
        )
      ).type,
      BRANCH_TYPE.chore,
    );
    assert.equal(
      (await classifyTask({ name: "t", description: "", agents: [], chains: [] }, deps({ query })))
        .type,
      BRANCH_TYPE.chore,
    );
  });
});
