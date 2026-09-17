// What the runner says and offers, checked by calling it.
//
// Until 06/09 `runner-payload/session-runner.mjs` was 1,696 lines and could not be imported: it
// reads its environment and calls `process.exit` on load. Everything checkable about it went
// through SOURCE READS, which caught real failures but never proved a sentence actually reaches
// the agent, only that it is written somewhere.
//
// The split pulled PURE modules out of it (`prompt.mts`, `mcp-tools.mts`…) with no side effects.
// Their guards became behaviour tests: build the prompt, read what the agent will receive; build
// the tools, read what it can call.
//
// What stays a source read is what stays in `session-runner.mts`: the WIRING. A text existing is
// one thing, being pushed into the input stream is another, and that gap switched off the three
// guardrails on 03/09.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildSystemPrompt,
  buildTaskPrompt,
  STYLE_SECTION,
  WAITING_SECTION,
  turnWarningText,
  uncommittedNoticeText,
  relaunchNoticeText,
} from "../../../../runner-payload/prompt.mjs";
import { buildTools } from "../../../../runner-payload/mcp-tools.mjs";
import { askStuck, askTurnBudget } from "../../../../runner-payload/pause-guards.mjs";
import {
  assistantEvents,
  rateLimitFields,
  toolResults,
} from "../../../../runner-payload/sdk-events.mjs";
import { buildQueryOptions } from "../../../../runner-payload/sdk-options.mjs";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { GuardIO } from "../../../../runner-payload/pause-guards.mjs";
import type { PromptRepo } from "../../../../runner-payload/prompt.mjs";
import type { ToolCall } from "../../../../runner-payload/sdk-events.mjs";
import type { TurnBudgetEvent } from "../../../../runner-payload/turn-budget.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUNNER = resolve(ROOT, "runner-payload/session-runner.mts");

const TURN_BUDGET = { pauseAt: 185, cap: 200 };
const SPEC = {
  taskName: "Split the runner",
  taskDescription: "Get runReal out of its thousand lines.",
  repoBranch: "legion/abc",
  agentName: "dev",
  rolePrompt: "You are a development agent.",
  artifactsPath: "/artifacts/abc",
};
const REPO = {
  name: "legion",
  dir: "/workspace/repos/legion",
  access: "write",
  testCommand: "make gates",
};

const taskPrompt = (spec: object = {}, repos: PromptRepo[] = [REPO]): string =>
  buildTaskPrompt({
    spec: { ...SPEC, ...spec },
    repos,
    turnBudget: TURN_BUDGET,
    checkpointEveryTurns: 15,
    inertiaStaleTurns: 30,
  });

// The task prompt.
// Seen 02/09: the prompt said "you do not need to run git commit or git push yourself", taking the
// gesture AWAY from the agent while the `commits-conventionnels` rule (system, all projects) taught
// it the form. Result on a real PR: two IDENTICAL commits for 17 files, the subject being the task
// name dressed as `feat`, impossible to review commit by commit. The instruction was reversed: the
// agent commits itself, as it goes, atomically.
describe("the task prompt asks the agent to commit itself", () => {
  it("no longer invites leaving git aside", () => {
    assert.doesNotMatch(
      taskPrompt(),
      /you do not need to run git commit/,
      "this sentence took the gesture away from the agent: it must no longer reach it",
    );
  });

  it("asks for atomic commits, one per coherent change", () => {
    const p = taskPrompt();
    assert.match(p, /Commit your[\s\S]{0,20}own work/i, "the agent must commit itself");
    assert.match(p, /atomic/i, "one commit per coherent change, not a catch-all commit");
    assert.match(
      p,
      /commits-conventionnels/,
      "points to the system rule rather than restating the conventional form a second time",
    );
  });

  it("says pushing stays with the server, and at what cadence", () => {
    const p = taskPrompt();
    assert.match(p, /[Dd]o not push/, "pushing stays the server's gesture, not the agent's");
    // The REAL cadence, not a hand-written number: it is what makes "do not push yourself"
    // credible rather than worrying.
    assert.match(
      p,
      /a checkpoint every 15 turns/,
      "the quoted cadence must be turn-tracker's, passed in and not copied",
    );
  });

  it("names each repository by its ABSOLUTE path, with its test command", () => {
    // 30/08: it was `./repos/<name>`, relative to a folder nothing named. `Read` and `Write` want
    // absolute paths, the agent completed on its own, with the only other path it knew: its Legion
    // space.
    assert.match(taskPrompt(), /- \/workspace\/repos\/legion \(write\) — tests: `make gates`/);
  });

  // 10/09, session `o5yN0TxYJOsY`: the full pass run FOUR times in seventeen minutes, the longest
  // 13 min 33.
  it("says the full command runs ONCE, at the end", () => {
    const p = taskPrompt();
    assert.match(p, /Run that command ONCE, at the end/, "one pass, at the end");
    assert.match(
      p,
      /only what covers what you just[\s\S]{0,10}changed/,
      "the short loop while working",
    );
    assert.doesNotMatch(
      taskPrompt({}, [{ ...REPO, testCommand: null }]),
      /Run that command ONCE/,
      "without a test command, this instruction is moot",
    );
  });

  // 10/09: the safety net committed without asking. The agent ran its `git commit` IN THE SAME
  // SECOND as the turn-105 checkpoint and got "nothing to commit". The text below is what now
  // reaches it BEFORE the net takes over: it must name the files, ask for a conventional subject,
  // and say what happens if ignored.
  it("the invitation to commit names the files, the gesture, and the deadline", () => {
    const t = uncommittedNoticeText("acme", ["a.ts", "b.ts", "c.ts"]);
    assert.match(t, /3 uncommitted file\(s\) in acme/);
    assert.match(t, /a\.ts, b\.ts, c\.ts/, "the paths, not only the count");
    assert.match(t, /conventional subject/);
    assert.match(
      t,
      /You do not have to push/,
      "pushing stays with the server: the instruction does not change",
    );
    assert.match(
      t,
      /next checkpoint/,
      "the deadline is stated, otherwise the invitation is not one",
    );
  });

  it("the invitation bounds the list: eight paths, then an ellipsis", () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
    const t = uncommittedNoticeText("acme", files);
    assert.match(t, /20 uncommitted file\(s\)/, "the count stays exact");
    assert.match(t, /f7\.ts, …/, "the list stops at eight");
    assert.doesNotMatch(t, /f8\.ts/);
  });

  it("without a granted repository, points to fs_write rather than a branch", () => {
    const p = taskPrompt({}, []);
    assert.match(p, /Persist deliverables with the legion fs_write tool/);
    assert.doesNotMatch(p, /Granted repositories/, "there are none: do not mention them");
  });

  it("the screenshot instruction appears ONLY for sessions with the browser", () => {
    // Giving it without the browser would ask the impossible, which teaches a model that prompt
    // instructions are optional.
    assert.doesNotMatch(taskPrompt(), /What changes on screen gets shown/);
    assert.match(taskPrompt({ browser: true }), /What changes on screen gets shown/);
  });

  it("a wake-up receives the human's answer, and nothing else", () => {
    // The conversation context is already there: resending the brief would make it start over.
    assert.equal(taskPrompt({ resume: { prompt: "Take option B." } }), "Take option B.");
  });
});

// The turn budget, stated up front (25/08).
// The Channels session started a ten-minute global check three turns from the wall, and died on
// it. The number alone is not enough: the prompt also says what is expected of a scope too big,
// because handing over is an engineering judgement, not an admission of failure.
/** The two inertia verdicts, as `inertia.mts` returns them; the numbers are those of the 10/09
 *  spec, so the text can be read next to it. */
const VERDICT_AVANCE = {
  turn: 130,
  inert: false,
  idleTurns: 9,
  sinceTurn: 121,
  staleTurns: 30,
  writable: true,
  commits: 4,
  writes: 37,
  lastCommitTurn: 121,
};
const VERDICT_INERTE = {
  turn: 130,
  inert: true,
  idleTurns: 32,
  sinceTurn: 98,
  staleTurns: 30,
  writable: true,
  commits: 0,
  writes: 12,
  lastCommitTurn: null,
};

/** A turn budget event, as `turn-budget.mts` returns it. `kind` and `warnAt` are set because the
 *  type carries them; none of the texts tested below quotes them. */
const HIT = (used: number, pauseAt: number, cap: number): TurnBudgetEvent => ({
  kind: used >= pauseAt ? "pause" : "warn",
  used,
  left: pauseAt - used,
  warnAt: pauseAt,
  pauseAt,
  cap,
});

describe("turn budget: the agent is informed, and knows what to do with the number", () => {
  it("the initial prompt states the REAL threshold, not a hand-written number", () => {
    const p = taskPrompt();
    assert.match(p, /## Turn budget/);
    assert.match(p, /about 185 turns/, "the pause threshold comes from turnBudget.pauseAt");
    assert.match(p, /hard-stops at 200/, "and the hard wall from turnBudget.cap");
    // Proof nothing is hard-coded: other thresholds give other sentences.
    const autre = buildTaskPrompt({
      spec: SPEC,
      repos: [REPO],
      turnBudget: { pauseAt: 40, cap: 60 },
      checkpointEveryTurns: 15,
    });
    assert.match(autre, /about 40 turns/);
    assert.match(autre, /hard-stops at 60/);
  });

  it("the prompt AND both warnings state the expected gesture when the scope does not fit", () => {
    const hit = HIT(180, 185, 200);
    const avance = turnWarningText(hit, VERDICT_AVANCE);
    const inerte = turnWarningText(hit, VERDICT_INERTE);
    for (const texte of [taskPrompt(), avance, inerte])
      for (const attendu of ["propose_task", "blocking: true", "plan"])
        assert.ok(
          texte.includes(attendu),
          `${attendu} must be named as the way out of a scope too big`,
        );
  });

  // 10/09: the measurement is in the text, which is the whole point. The old warning only said
  // "180 used, 5 before pause": the agent had to decide whether it fit without knowing what its
  // session had produced. That text stopped lot 1 of the navigation tidy-up around 140 turns,
  // thirty-five turns before the pause question was even asked.
  it("the warning of a session THAT MOVES announces the relaunch, asking nothing", () => {
    const t = turnWarningText(HIT(130, 175, 200), VERDICT_AVANCE);
    assert.match(t, /Turn 130 of 175/);
    assert.match(t, /4 commit\(s\) pushed \(last at turn 121\)/);
    assert.match(t, /37 successful write\(s\)/);
    assert.match(t, /start you again in a fresh session at 175/);
    assert.ok(!t.includes("is something broken"), "it is moving: no interrogation");
  });

  it("the warning of an INERT session carries the measurement and asks the question", () => {
    const t = turnWarningText(HIT(130, 175, 200), VERDICT_INERTE);
    assert.match(t, /Nothing came out of your last 32 turns/);
    assert.match(
      t,
      /no commit pushed and no successful write since turn 98/,
      "the operator's request, word for word: the measurement THEN the question",
    );
    assert.match(t, /you are at turn 130 of 175/);
    assert.match(t, /is something broken/);
    assert.match(t, /inbox_ask/);
  });

  it("the relaunch text tells the next session what just happened", () => {
    const t = relaunchNoticeText(HIT(175, 175, 200), VERDICT_AVANCE);
    assert.match(t, /175 turns and was moving/);
    assert.match(t, /4 commit\(s\) pushed/);
    assert.match(t, /turn budget back to zero/);
    assert.match(t, /Nobody interrupted you/);
  });

  it("no writable repository: the text does not count commits that could not exist", () => {
    const t = turnWarningText(HIT(130, 175, 200), {
      ...VERDICT_AVANCE,
      writable: false,
      commits: 0,
      lastCommitTurn: null,
    });
    assert.match(t, /no repository with write access in this session/);
    assert.ok(
      !t.includes("commit(s) pushed"),
      "announcing 0 commits to a read-only agent is a false reproach",
    );
  });

  it("the warning enters through the STREAM, like a user turn: the wiring stays in the runner", () => {
    // The only source check left for this text, and the right one: its existence does not prove it
    // reaches the agent. The 03/09 defect was exactly that gap.
    assert.match(readFileSync(RUNNER, "utf8"), /promptStream\.push\(turnWarningText\(/);
  });

  // Same check, same reason (10/09): the 03/09 defect was not a wrong guardrail but one never
  // called. The inertia rule is tested separately; what is checked here is that it is FED every
  // turn and DECIDES between relaunch and question at the pause turn.
  it("inertia is fed every turn, and it chooses between relaunch and question", () => {
    const src = readFileSync(RUNNER, "utf8");
    assert.match(src, /inertia\.record\(\{ turn: ended\.used/, "fed at every turn end");
    assert.match(
      src,
      /const verdict = inertia\.verdict\(ended\.used\)/,
      "asked again after the pause turn's checkpoint",
    );
    // The two assertions copying the `if/else` are gone (14/09). They required
    // `if (!verdict.inert) { if (await requestRelaunch(` and `} else if (spec.inboxEnabled &&`, i.e.
    // the code's shape rather than a fact about it: they could only fail on a line break or a rename,
    // which is exactly what happened when the formatter came through. Reading the source remains the
    // only way to reach the two facts above while `onTurnEnd` cannot be instantiated alone.
    //
    // That BOTH branches exist is no longer held by anyone. A deliberate loss: an assertion unable to
    // tell "the branch disappeared" from "the line moved" held nothing already.
    assert.match(src, /requestRelaunch\(/, "the relaunch is called somewhere");
    assert.match(src, /askTurnBudget\(/, "the budget question too");
  });

  // 11/09: inertia no longer waits for the pause turn. A session broken at turn 40 burnt the whole
  // remaining budget (up to 175, then 375) with nobody knowing: the turn budget was the question's
  // only trigger. `idleTurns` is true well before, and that fact, not the turn counter, must decide.
  // ONE source check (reading and asserting on this text is tracked debt in
  // `arch-metrics-baseline.json`, not a reflex). The sequence below proves the declaration, the
  // one-episode bound, the independence from the turn budget AND no repeat at the warning turn, in
  // the ORDER the file writes them (a `[\s\S]*?` that does not match in order would say so).
  it("inertia is asked as soon as it is true, once per episode, without repeating at the turn budget", () => {
    const src = readFileSync(RUNNER, "utf8");
    assert.match(
      src,
      /let inertiaNudgedSinceTurn: number \| null = null;[\s\S]*?const idle = inertia\.verdict\(ended\.used\);[\s\S]*?if \(idle\.inert && inertiaNudgedSinceTurn !== idle\.sinceTurn\)[\s\S]*?inertiaNudgedSinceTurn = idle\.sinceTurn;[\s\S]*?if \(!idle\.inert && !promptStream\.push\(turnWarningText\(turn, idle\)\)\)/,
      "the episode (inertiaNudgedSinceTurn) and the verdict (idle) must precede, in this order, " +
        "the turn budget logic, otherwise inertia would stay hooked to a budget turn",
    );
  });
});

// The system prompt.
describe("the system prompt assembles what only the container knows", () => {
  const system = (rulesSection = "", repos: PromptRepo[] = [REPO]): string =>
    buildSystemPrompt({ spec: SPEC, cwd: "/workspace", repos, rulesSection });

  it("the role comes from the server, the rest from here", () => {
    const s = system("## Rules\n\na rule");
    assert.ok(s.startsWith("You are a development agent."), "the role opens the prompt");
    assert.match(s, /## Workspace/);
    assert.match(s, /## Output style/);
    assert.match(s, /## Rules/);
  });

  it("a session without rules has no empty section", () => {
    // `filter(Boolean)`: a "## Rules" section followed by nothing would teach the model a section can
    // be empty, and it would draw conclusions about the others.
    const s = system("");
    assert.doesNotMatch(s, /## Rules/);
    assert.doesNotMatch(s, /\n\n\n/, "no gap left by a missing section");
  });

  it("repositories are NAMED one by one, never given as a pattern", () => {
    // 30/08: the agent burnt four turns looking for its repositories, prefixing its clone path with
    // its Legion space path. Naming removes the guessing.
    assert.match(system(), /- `legion` → `\/workspace\/repos\/legion`/);
    assert.match(system(), /TWO FILE SYSTEMS COEXIST/);
    assert.match(system(), /\/agents\/dev/, "and THIS agent's Legion space is named too");
  });

  // Same defect as the repositories, later (16/09). The prompt said "this task's artifacts folder"
  // without ever giving its path: a scope is an identifier, it cannot be guessed. The agent listed
  // `/artifacts`, granted to nobody, got refused and read its grants in the error message. Twelve
  // sessions, five agents, one turn lost each time, while the spec always carried the value.
  it("the artifacts folder is named by its PATH, not described", () => {
    assert.match(system(), /\/artifacts\/abc/);
  });

  it("the style section forbids emoji: it depends on nothing and is not computed", () => {
    // 30/08: the agent's last message is rendered as is in the report tab, and rule 7 of
    // docs/DESIGN.md forbids emoji in the UI. A model-produced sentence displayed in the UI IS UI.
    assert.match(STYLE_SECTION, /Never write emoji/);
    assert.ok(system().includes(STYLE_SECTION), "and it enters the system prompt as is");
  });

  it("the prompt says NOT to wait for a background task, otherwise three turns burn", () => {
    // 10/09: `sleep 90 && tail -120 …/tasks/<id>.output`, refused by the harness; then a ToolSearch
    // for `Monitor`; then `TaskOutput`. The refusal teaches the same thing, but after costing the
    // turn. What was missing was not the tool but "do not wait".
    assert.match(WAITING_SECTION, /NOTIFIES you when it ends/);
    assert.match(WAITING_SECTION, /NEVER poll/);
    assert.ok(system().includes(WAITING_SECTION), "and it enters the system prompt");
  });
});

// The MCP tools.
describe("MCP tools: what the session can call", () => {
  /** A test `tool()`: the real one comes from the SDK, which `runner-payload/` cannot resolve,
   *  which is precisely why it is injected. */
  const tool = (name: string, description: string, schema: object, handler: unknown) => ({
    name,
    description,
    schema,
    handler,
  });
  const z = {
    string: () => ({}),
    enum: () => ({}),
    object: () => ({}),
    array: () => ({}),
    union: () => ({}),
    literal: () => ({}),
    boolean: () => ({}),
    number: () => ({}),
  } as never;

  const names = (spec: object): string[] => {
    const call = async () => ({ ok: true, status: 200, body: {} });
    // zod validates nothing here: the LIST is under test, not the schemas.
    const real = z as unknown as Record<string, () => unknown>;
    for (const k of Object.keys(real)) {
      const chain: Record<string, unknown> = {};
      for (const m of ["optional", "describe", "min", "max"]) chain[m] = () => chain;
      real[k] = () => chain;
    }
    return (
      buildTools({
        tool: tool as never,
        z,
        // The default is WITHOUT inbox: it is a grant, not a given, which the first case below checks.
        // Each test that wants it asks for it.
        spec: { inboxEnabled: false, ...spec },
        callInternal: call,
        updateTask: call,
        pause: () => {},
      }) as {
        name: string;
      }[]
    ).map((t) => t.name);
  };

  it("a session without inbox has ONLY the task state and the files", () => {
    assert.deepEqual(names({}), [
      "update_task",
      "fs_list",
      "fs_read",
      "fs_write",
      "fs_mkdir",
      "fs_delete",
    ]);
  });

  it("a granted inbox adds the five tools that talk to the human", () => {
    // They do not EXIST without the grant, rather than existing and refusing: a tool that always
    // answers "no" teaches the model to call it again. `request_repo` (09/09) belongs here: asking
    // for a repository is asking the human.
    assert.deepEqual(names({ inboxEnabled: true }).slice(6), [
      "inbox_ask",
      "inbox_send",
      "propose_task",
      "wait_for_task",
      "request_repo",
    ]);
  });

  it("the three pausing tools receive the runner's gesture, they do not invent it", () => {
    // The module knows neither `AbortController` nor the 400 ms delay: "return the result then stop"
    // is the runner's decision, which keeps a single exit path. Comments are stripped: the module
    // header EXPLAINS why the pause is not an `AbortController`, so it names it. A guard tripping on
    // its own documentation gives false positives, and such a guard ends up disabled.
    const source = readFileSync(resolve(ROOT, "runner-payload/mcp-tools.mts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
      .join("\n");
    assert.doesNotMatch(
      source,
      /abort|AbortController|setTimeout/,
      "no stopping mechanism may live in the tool definitions",
    );
    assert.match(
      readFileSync(RUNNER, "utf8"),
      /const pauseSession = \(\) => \{\s*\n\s*pausing = true;\s*\n\s*setTimeout\(\(\) => abortNow\("pause"\), 400\);/,
      "and the runner must provide it",
    );
  });
});

// The mid-run pause questions.
// Stall and turn budget. DETECTION lives in stuck.mts and turn-budget.mts, each tested at home.
// What is checked here is the REACTION, which had stayed in the runner as thirty-line blocks never
// read together: a session is never killed, a question is asked, and if the inbox does not answer
// we SAY so.
describe("mid-run pauses ask a question, they do not kill", () => {
  /** A test runner: counts pauses, keeps what went to the inbox and the trace. */
  function harness(inbox: { ok: boolean; status: number }) {
    const asked: Record<string, unknown>[] = [];
    const reported: { type: string; payload: Record<string, unknown> }[] = [];
    let pauses = 0;
    let activity = "(nothing yet)";
    return {
      asked,
      reported,
      pauses: () => pauses,
      setActivity: (a: string) => {
        activity = a;
      },
      io: {
        spec: { model: "claude-opus-4" },
        callInternal: async (path: string, body: Record<string, unknown>) => {
          assert.equal(path, "/inbox", "they all go through the inbox, not a channel of their own");
          asked.push(body);
          return { ...inbox, body: {} };
        },
        report: async (type: string, payload?: Record<string, unknown>) => {
          reported.push({ type, payload: payload ?? {} });
        },
        pause: () => {
          pauses += 1;
        },
        lastActivity: () => activity,
      },
    };
  }

  const HITS = {
    stuck: {
      reason: "3 identical calls",
      tool: "Bash",
      input: '{"command":"pnpm test"}',
      total: 3,
      fails: 2,
    },
    turn: HIT(185, 185, 200),
  };
  // Each guardrail carries ITS measurement: they differ in shape, and pairing them here avoids
  // describing a measurement that would be both at once.
  const GUARDS = [
    {
      nom: "stall",
      trace: /treading water detected/,
      ask: (io: GuardIO) => askStuck(io, HITS.stuck),
    },
    {
      nom: "turn budget",
      trace: /turn budget reached/,
      ask: (io: GuardIO) => askTurnBudget(io, HITS.turn),
    },
  ];

  for (const g of GUARDS) {
    it(`${g.nom}: the question leaves, the session pauses, and the human has what it takes to decide`, async () => {
      const h = harness({ ok: true, status: 200 });
      assert.equal(await g.ask(h.io), true, "the caller learns the session stops");
      assert.equal(h.pauses(), 1, "one pause, not two");
      assert.equal(h.asked.length, 1);
      const q = h.asked[0]!;
      assert.equal(q.kind, "choice");
      // `evidence` and `impact` let the human answer from the queue without reopening the session,
      // which is why it is a question rather than a hard stop.
      assert.ok(String(q.evidence ?? "").length > 40, "the question carries what was observed");
      assert.ok(String(q.impact ?? "").includes("when it restarts"), "and what the answer will do");
      assert.equal((q.choices as unknown[]).length, 3, "three outcomes, never a yes/no");
      assert.deepEqual(h.reported, [], "nothing to report when the question left");
    });

    it(`${g.nom}: inbox unreachable, the session goes on, but says so`, async () => {
      // A session that should have stopped and did not is already bad; doing so without a trace makes
      // it undebuggable.
      const h = harness({ ok: false, status: 503 });
      assert.equal(await g.ask(h.io), false);
      assert.equal(h.pauses(), 0, "no pause: the question never reached anyone");
      assert.equal(h.reported.length, 1);
      assert.equal(h.reported[0]!.type, "run_warning");
      const message = String(h.reported[0]!.payload.message);
      assert.match(message, g.trace, "the warning names the reason");
      assert.match(message, /503/, "and the code that prevented the question");
    });
  }

  it("the budget question says WHAT the session was doing, read when asking", () => {
    // `lastActivity` changes with every message: passed by value, it would stay "(nothing yet)"
    // forever, and the human would have to reopen the trace to decide.
    const h = harness({ ok: true, status: 200 });
    h.setActivity("tool Bash (pnpm --filter @legion/server test)");
    return askTurnBudget(h.io, HITS.turn).then(() => {
      for (const q of h.asked) assert.match(String(q.evidence), /Last activity: tool Bash/);
    });
  });
});

// SDK message shapes.
// `runReal`'s loop sorted them itself in a five-level `else if`, the only place in the file
// measured at six nesting levels. The three readers are pure, so they get messages and we look at
// what they extract.
describe("SDK message shapes, read rather than guessed", () => {
  it("an assistant turn returns its tool calls and texts, in order", () => {
    const events = assistantEvents({
      message: {
        content: [
          { type: "text", text: "  Looking at the file.  " },
          { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "/a.ts" } },
          { type: "text", text: "   " },
        ],
      },
    });
    assert.deepEqual(
      events.map((e: { type: string }) => e.type),
      ["text", "tool_start"],
      "an empty text is not an event: it would add noise to the timeline",
    );
    assert.equal(events[1]!.call!.id, "tu_1", "the call is kept to be paired with its result");
    assert.match(
      events[1]!.activity,
      /tool Read/,
      "and it is what the inbox shows if we stop there",
    );
    assert.match(events[0]!.activity, /text: "Looking at the file\."/);
  });

  it("an assistant turn without content produces nothing", () => {
    assert.deepEqual(assistantEvents({}), []);
    assert.deepEqual(assistantEvents({ message: {} }), []);
  });

  // `parent_tool_use_id` is the ONLY thing telling a subagent from the main thread, and on 08/09
  // nobody read it: the thirteen subagents of AI-2200's translation fan-out counted as the parent,
  // and their ten identical reads of the instructions file triggered the stall detector. The trace
  // keeps them (we want to see the fan-out), the counter ignores them; see `sub` in stuck.mts.
  it("a SUBAGENT turn marks its calls, so they do not count as repetitions", () => {
    const call = (msg: object): ToolCall => assistantEvents(msg)[0]!.call!;
    const content = [
      { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "/tmp/rules.md" } },
    ];
    assert.equal(call({ parent_tool_use_id: "tu_parent", message: { content } }).sub, true);
    assert.equal(
      call({ parent_tool_use_id: null, message: { content } }).sub,
      false,
      "the main thread stays watched: a message without a parent is the parent",
    );
    assert.equal(call({ message: { content } }).sub, false, "a missing field is not a subagent");
  });

  it("a user message carries its tool results, with their success", () => {
    assert.deepEqual(
      toolResults({
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_1", is_error: false },
            { type: "text", text: "noise" },
            { type: "tool_result", tool_use_id: "tu_2", is_error: true },
          ],
        },
      }),
      [
        { toolUseId: "tu_1", ok: true },
        { toolUseId: "tu_2", ok: false },
      ],
    );
  });

  // 08/09: the trace only kept the boolean. Session `yDGjmOVom2_u`: two `Bash` failing within
  // sixteen milliseconds, the agent gives up saying "Bash is being denied here", and nothing in
  // the 491 events says by what. Without the reason the failure cannot be diagnosed.
  // 08/09: `sub` only served the stall detector; the STORED payload carried nothing, so the UI
  // and any rule wanting to count a fan-out were blind.
  it("a subagent call carries, IN ITS PAYLOAD, the Agent call that started it", () => {
    const content = [
      { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "/tmp/r.md" } },
    ];
    const [child] = assistantEvents({ parent_tool_use_id: "tu_parent", message: { content } });
    assert.equal(child!.payload.parent, "tu_parent");
    assert.equal(
      child!.payload.id,
      "tu_1",
      "the call carries its own id: its end finds it by that",
    );
    const [main] = assistantEvents({ message: { content } });
    assert.equal(main!.payload.parent, undefined, "the main thread invents no parent");
  });

  it("a subagent's text is also told apart from the main thread's", () => {
    const content = [{ type: "text", text: "I'll start by reading the rules file." }];
    assert.equal(
      assistantEvents({ parent_tool_use_id: "tu_parent", message: { content } })[0]!.payload.parent,
      "tu_parent",
    );
    assert.equal(assistantEvents({ message: { content } })[0]!.payload.parent, undefined);
  });

  it("a failed result carries its reason, whatever the content shape", () => {
    const one = (block: object): { error?: string } =>
      toolResults({
        message: { content: [{ type: "tool_result", tool_use_id: "tu_1", ...block }] },
      })[0]!;
    assert.equal(
      one({ is_error: true, content: "Permission to use Bash has been denied." }).error,
      "Permission to use Bash has been denied.",
      "the content can be a bare string",
    );
    assert.equal(
      one({ is_error: true, content: [{ type: "text", text: "refused" }, { type: "image" }] })
        .error,
      "refused",
      "…or typed blocks, of which only texts are read",
    );
    assert.equal(
      one({ is_error: true }).error,
      undefined,
      "a failure without text does not invent an empty reason",
    );
  });

  it("a success's DATA stays out of the trace", () => {
    // A long successful result is a whole file: volume that teaches nothing and would drown the
    // rest.
    assert.deepEqual(
      toolResults({
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              is_error: false,
              content: "x".repeat(5000),
            },
          ],
        },
      }),
      [{ toolUseId: "tu_1", ok: true }],
    );
  });

  // 10/09, session `o5yN0TxYJOsY`: `pnpm -s test` closed as finished at EXACTLY two minutes, the
  // tool's timeout. The suite was not finished, it had moved to the background, and the notice
  // saying so was dropped with the rest of the successes. The next twenty lines show the agent
  // reading an `.output` file nothing explains.
  it("a success's NOTICE enters the trace: sometimes it is the whole story", () => {
    const notice =
      "Command did not complete within its 120s timeout and was moved to the background " +
      "(ID: bmf0xr40p). Output is being written to: /tmp/tasks/bmf0xr40p.output.";
    const [r] = toolResults({
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false, content: notice }],
      },
    });
    assert.equal(r!.result, notice);
    assert.equal(r!.ok, true, "the call did succeed: that is the true part of “finished”");
  });

  it("an oversized reason is truncated like a call's input", () => {
    // 2,000 since 08/09, raised together with a `tool_start`'s input: at 300 an error message lost
    // the part saying what to fix. The ceiling stays, only its value changed: a failed tool result is
    // not a whole file.
    const [r] = toolResults({
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu_1", is_error: true, content: "y".repeat(5000) },
        ],
      },
    });
    assert.equal(r!.error!.length, 2_000, "2,000 characters, like `tool_start.input`");
  });

  it("a user message injected by steering is not a tool result", () => {
    // Steering pushes text into the stream: without this case, a human's "change course" would read
    // as a tool result without a call.
    assert.deepEqual(toolResults({ message: { content: "change course" } }), []);
    assert.deepEqual(toolResults({}), []);
  });

  it("an exhausted quota is recognised by `rejected`, and names its window", () => {
    // 24/08, i18n session: without this reading, the SDK restarts the conversation and retries in a
    // loop: twenty minutes, eleven `init`s, nine refusals.
    const plein = rateLimitFields({
      rate_limit_info: { status: "allowed", utilization: 12, rateLimitType: "five_hour" },
    });
    assert.equal(plein.exhausted, false);
    assert.equal(plein.payload.kind, "rate_limit");
    assert.equal(plein.payload.utilization, 12);

    const vide = rateLimitFields({
      rate_limit_info: {
        status: "rejected",
        rateLimitType: "seven_day",
        resetsAt: "2026-09-07T00:00:00Z",
      },
    });
    assert.equal(vide.exhausted, true);
    assert.equal(vide.window, "seven_day");
    assert.equal(vide.payload.resetsAt, "2026-09-07T00:00:00Z");
  });

  it("a quota event without information does not pretend to know its window", () => {
    const rien = rateLimitFields({});
    assert.equal(rien.exhausted, false);
    assert.equal(
      rien.window,
      "unknown window",
      "say so rather than writing `undefined` to the operator (the literal is the payload's own string)",
    );
  });
});

// The session's permission model.
// `buildQueryOptions` is declarative and pure: what is granted to the SDK and what is refused.
// Each line has a history, and until 06/09 none had a test: they lived in the middle of the
// message loop.
describe("what the runner grants the SDK, and what it refuses", () => {
  const abort = new AbortController();
  const options = (spec: object = {}, extra: object = {}) =>
    buildQueryOptions({
      spec: { model: "claude-opus-4", allowedTools: ["Bash", "Read"], ...spec },
      cwd: "/workspace",
      legion: { name: "legion" } as unknown as McpServerConfig,
      externalMcp: {},
      skillNames: [],
      systemPrompt: "SYS",
      hooks: {},
      abort,
      ...extra,
    }) as Record<string, unknown>;

  it("no DISK configuration can add an MCP server", () => {
    // `strictMcpConfig` ignores `.mcp.json` and settings: only the spec counts. Least privilege on
    // the surface easiest to widen by accident.
    const o = options({}, { externalMcp: { linear: { url: "x" } } });
    assert.equal(o.strictMcpConfig, true);
    assert.deepEqual(Object.keys(o.mcpServers as object), ["legion", "linear"]);
  });

  it("repository rules have only ONE path to the prompt, the runner's", () => {
    // v63: Acme's `.claude/rules/` are versioned (13 files in `backend`, 21 in `acme`). Loaded
    // natively AS WELL, they would grow the context instead of trimming it, and the `locked` lock
    // can only exist if a single path leads there.
    assert.deepEqual((options().settings as { claudeMdExcludes: string[] }).claudeMdExcludes, [
      "/workspace/repos/*/.claude/rules/**",
    ]);
    // And the exclusion is PROGRAMMATIC: `<cwd>/.claude/settings.json` is exactly the file the
    // workspace cleanup erases at every start, because the agent can write it.
    assert.deepEqual(options().settingSources, ["project"]);
  });

  it("model axes are OMITTED when the spec does not carry them", () => {
    // Setting `undefined` explicitly is not the same as setting nothing: the SDK default must stay
    // the default.
    assert.equal("effort" in options(), false);
    assert.equal("thinking" in options(), false);
    assert.equal(options({ effort: "high" }).effort, "high");
  });

  it("skills are enabled only if they were actually written to disk", () => {
    assert.equal("skills" in options(), false, "no skill written, none enabled");
    assert.deepEqual(options({}, { skillNames: ["lean-ctx"] }).skills, ["lean-ctx"]);
  });

  it("a wake-up resumes the SDK conversation, a start has nothing to resume", () => {
    assert.equal("resume" in options(), false);
    assert.equal(options({ resume: { sdkSessionId: "sess_42" } }).resume, "sess_42");
  });

  it("the hard wall stays at 400 turns, and the agent never asks for permission", () => {
    // 40 killed healthy tasks. What stops a stuck session is the stall detector, which asks a
    // question, not this ceiling.
    assert.equal(options().maxTurns, 400);
    assert.equal(options().permissionMode, "dontAsk");
  });
});

// Does the payload still start?
// No test asked, and the 06/09 split made that gap dangerous: ten modules became fifteen, each
// pulled by a relative `import()` nothing resolves before runtime. A wrong path breaks neither
// `node --check`, the linter nor `tsc`: it breaks the first real session, and 04/09
// (`turn-outcome.mjs` not shipped) showed what that looks like: four tasks dead on `exit 1`
// before their first `report`.
//
// This test starts the REAL process against a toy control plane and watches what comes out. It
// takes the MOCK path, which never calls the model, the only one that can run here (`runReal`
// needs the SDK, which `runner-payload/` cannot resolve). It still goes through spec loading, the
// environment, the numbered log, the file tools and the clean exit: everything the split touched
// upstream of the message loop.
describe("the payload really starts, and reports", () => {
  it("a mock chain step goes all the way: init, artifact written, result, exit 0", async () => {
    const events: { seq: number; type: string }[] = [];
    const written: string[] = [];
    const spec = {
      sessionId: "sess-boot",
      mock: true,
      model: "mock",
      agentName: "dev",
      taskId: "T1",
      taskName: "Chain step",
      artifactsPath: "/artifacts/T1",
      expectedArtifacts: ["pr.md"],
      callbackToken: "token",
    };

    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += String(c);
      });
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        res.setHeader("content-type", "application/json");
        if (req.url === "/spec") {
          assert.equal(req.headers["x-legion-boot"], "nonce", "the boot nonce travels in a header");
          return res.end(JSON.stringify({ ...spec, callbackUrl: `http://127.0.0.1:${port}` }));
        }
        if (req.url?.endsWith("/events")) {
          events.push(body);
          // The ACK is what drains the queue: without it the runner would replay everything (26/08 failure).
          return res.end(JSON.stringify({ ack: body.seq }));
        }
        if (req.url?.endsWith("/fs")) {
          written.push(String(body.path));
          return res.end(JSON.stringify({ result: "ok" }));
        }
        return res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    try {
      // The `.mts` source under `tsx`, same mechanism as the ProcessRunner (`process.ts`) since the
      // payload became TypeScript: the image gets compiled `.mjs`, but here the file runs as it is on
      // disk. `import.meta.resolve` gives an absolute URL, which is needed: Node would resolve a bare
      // `--import tsx` from the child's cwd.
      const runner = resolve(ROOT, "runner-payload/session-runner.mts");
      const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), runner], {
        env: {
          ...process.env,
          LEGION_SPEC_URL: `http://127.0.0.1:${port}/spec`,
          LEGION_BOOT: "nonce",
          LEGION_PROXY: "",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (c) => {
        stderr += String(c);
      });
      const code = await new Promise<number>((r) => {
        child.on("exit", (c) => r(c ?? -1));
      });

      assert.equal(code, 0, `the payload must exit cleanly, stderr:\n${stderr}`);
      assert.deepEqual(
        events.map((e) => e.type),
        ["init", "tool_end", "result"],
      );
      assert.deepEqual(
        events.map((e) => e.seq),
        [1, 2, 3],
        "the log is numbered, without gaps",
      );
      assert.deepEqual(
        written,
        ["/artifacts/T1/pr.md"],
        "the artifact promised by the step is written by the file tool, not on the local disk",
      );
    } finally {
      server.close();
    }
  });
});

// Every payload module loads.
// The test above starts the payload through the MOCK path, which imports almost nothing: the
// `runReal` modules are only pulled in a real session, by `import()`s evaluated at the first turn.
// A wrong path would sleep there until the container.
//
// Here they all really load. That does not prove they do the right thing (the tests above do),
// but it proves they RESOLVE, along with what they import. Exactly the check missing on 04/09.
/** Modules carrying ONLY types: their compiled `.mjs` has no runtime export, by construction. */
const TYPES_ONLY = new Set(["session-spec.mts", "runner-io.mts"]);

describe("every payload module loads, and its imports resolve", () => {
  it("the payload modules import without error or side effect", async () => {
    const dir = resolve(ROOT, "runner-payload");
    const modules = readdirSync(dir)
      .filter((f) => f.endsWith(".mts"))
      .sort();
    assert.ok(modules.length > 10, "the folder must carry the payload");
    for (const f of modules) {
      // `session-runner.mts` alone is excluded, the whole point of the split: it reads its environment
      // and calls `process.exit` on load, so importing it would kill this test. The test above runs it
      // in ITS own process.
      // The two CONTRACT modules are excluded for the OPPOSITE reason: they carry only types (session
      // spec, runner channels), so their compiled `.mjs` is empty by construction. The compiler checks
      // them, plus `payload-spec.test.ts` for the one crossing the boundary.
      if (TYPES_ONLY.has(f) || f === "session-runner.mts") continue;
      const m = (await import(resolve(dir, f))) as Record<string, unknown>;
      assert.ok(
        Object.keys(m).length > 0,
        `${f} exports nothing: a payload module without exports is dead`,
      );
    }
  });
});
