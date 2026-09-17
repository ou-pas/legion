// The wiring test, the one that was missing, without which the 03/09 defect stayed invisible for the
// guardrails' whole life.
//
// turn-budget.mts already had unit tests (thresholds, boundaries, inconsistent settings), all green,
// all useless, because nobody called `record()`. The runner recognised a turn end by
// `msg.message.stop_reason != null`, a condition the SDK's stream path never meets. Measured on
// 03/09 on real sessions: 105, 126, 82 and 75 turns reported by the SDK, ZERO `repo_checkpoint`,
// zero `turn_budget_warning`.
//
// A TOKEN budget shared that wiring until 08/09; it is gone (see runner-payload/pause-guards.mts).
// This file only tests what remains, and the `stop_reason` ban below holds for anything that plugs
// in here later.
//
// A guardrail that never fires produces NO message: nothing in the UI or the thread tells "no
// checkpoint needed" from "dead checkpoint". Hence this file, which replays an SDK message sequence
// as it really arrives and checks the counter MOVES. Put the faulty condition back and the first
// assertion fails.
//
// The module is .mts compiled into the session image (like stuck.mts and turn-budget.mts), imported
// as is: THE CODE THAT RUNS is what is tested.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createTurnBudgetWatch } from "../../../runner-payload/turn-budget.mjs";
import {
  CHECKPOINT_EVERY_MS,
  CHECKPOINT_EVERY_TURNS,
  createTurnTracker,
} from "../../../runner-payload/turn-tracker.mjs";
import type { EndedTurn } from "../../../runner-payload/turn-tracker.mjs";

type Usage = { input_tokens?: number; output_tokens?: number };
type Msg = Record<string, unknown>;

// Both types are derived from the module since lot 10. The closed turn and tracker shape used to be
// copied here, each call carrying an `as Tracker`, the only option while the payload was untyped JS.
// A copy the compiler does not reread guards nothing: a field renamed in the module left it green.
type Ended = EndedTurn;
type Tracker = ReturnType<typeof createTurnTracker>;

/** ONE assistant response chunk as the SDK STREAMS it: a single content block, the id shared by
 *  all chunks of the same turn, and a NULL `stop_reason`, which is the point.
 *  (SDKAssistantMessage, SDK 0.3.234 : "several consecutive assistant messages can share
 *  message.id […] on those, message.stop_reason is null and message.usage is not final".) */
function streamed(id: string, block: "text" | "thinking" | "tool_use", usage: Usage = {}): Msg {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id, stop_reason: null, content: [{ type: block }], usage },
  };
}

/** The same chunk in CONSOLIDATED form (on-disk transcripts): `stop_reason` and final usage are
 *  already set on EACH chunk of the turn. Counting chunks would give three turns for one. */
function consolidated(id: string, block: "text" | "tool_use", usage: Usage = {}): Msg {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id, stop_reason: "tool_use", content: [{ type: block }], usage },
  };
}

/** The end message, as the SDK emits it. `observe` only reads `type`; the fixture carries the other
 *  two fields because that is what really arrives: the runner passes the WHOLE message, never an
 *  object reduced to the fields read. */
function result(numTurns = 0): Msg {
  return { type: "result", subtype: "success", num_turns: numTurns };
}

function makeTracker(opts: Record<string, unknown> = {}) {
  const turnBudget = createTurnBudgetWatch({ warnAt: 10, pauseAt: 20 });
  const tracker = createTurnTracker({ turnBudget, ...opts });
  return { tracker, turnBudget };
}

/** Replays `n` streamed turns (three chunks each, like a text answer + two tools) and returns
 *  everything the tracker announced along the way. */
function replayStreamedTurns(
  tracker: Tracker,
  n: number,
  usage: Usage = { input_tokens: 100, output_tokens: 10 },
): Ended[] {
  const ended: Ended[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `msg_${i}`;
    ended.push(...tracker.observe(streamed(id, "thinking", usage)));
    ended.push(...tracker.observe(streamed(id, "tool_use", usage)));
    ended.push(...tracker.observe(streamed(id, "tool_use", usage)));
    // The tool result comes back as a `user` message: it ends no turn.
    ended.push(
      ...tracker.observe({ type: "user", message: { content: [{ type: "tool_result" }] } }),
    );
  }
  return ended;
}

describe("the turn counter COUNTS: the wiring between the SDK stream and the guardrails", () => {
  it("a twenty-turn stream moves turnBudget.used by twenty", () => {
    // The assertion that fails if `stop_reason != null` comes back: in this sequence NO message
    // carries a `stop_reason`, yet twenty turns did happen.
    const { tracker, turnBudget } = makeTracker();
    replayStreamedTurns(tracker, 20);
    // The 20th turn stays open until something closes it: the `result` does.
    assert.equal(turnBudget.used, 19, "nineteen turns closed by the next turn's arrival");
    tracker.observe(result(20));
    assert.equal(
      turnBudget.used,
      20,
      "the `result` closes the last turn, otherwise it would never count",
    );
  });

  it("the replayed sequence contains NO `stop_reason`: the whole 03/09 defect", () => {
    // This does not test the tracker but the FIXTURE, so the previous test keeps its meaning. If these
    // messages ever carried a `stop_reason`, the regression test above would also pass with the faulty
    // condition, and protect nothing.
    const msgs = [
      streamed("msg_1", "text"),
      streamed("msg_1", "tool_use"),
      streamed("msg_2", "text"),
    ];
    for (const m of msgs)
      assert.equal((m.message as { stop_reason: string | null }).stop_reason, null);
  });

  it("chunks of the same turn count ONCE, whatever their form", () => {
    // Consolidated form: each chunk already carries `stop_reason`. Three chunks, one turn.
    const { tracker, turnBudget } = makeTracker();
    tracker.observe(consolidated("msg_1", "text"));
    tracker.observe(consolidated("msg_1", "tool_use"));
    tracker.observe(consolidated("msg_1", "tool_use"));
    assert.equal(
      turnBudget.used,
      1,
      "one `message.id` = one turn, not one content block = one turn",
    );
    tracker.observe(consolidated("msg_2", "text"));
    assert.equal(turnBudget.used, 2);
  });

  it("a streamed turn ending with a `stop_reason` chunk counts once, not twice", () => {
    const { tracker, turnBudget } = makeTracker();
    tracker.observe(streamed("msg_1", "thinking"));
    tracker.observe(streamed("msg_1", "tool_use"));
    tracker.observe(consolidated("msg_1", "tool_use")); // same id, explicit end
    assert.equal(turnBudget.used, 1);
    assert.equal(tracker.openTurnId, null, "the turn is closed, not reopened by its own id");
  });

  it("a SUBAGENT's messages do not move the main loop's budget", () => {
    const { tracker, turnBudget } = makeTracker();
    tracker.observe(streamed("msg_1", "tool_use"));
    const sub = { ...streamed("sub_1", "text"), parent_tool_use_id: "toolu_42" };
    tracker.observe(sub);
    tracker.observe(sub);
    assert.equal(turnBudget.used, 0, "the main turn is neither closed nor recounted by a subagent");
    assert.equal(tracker.openTurnId, "msg_1", "and it stays the open turn");
    tracker.observe(streamed("msg_2", "text"));
    assert.equal(turnBudget.used, 1);
  });

  it("the turn budget warning and pause come up, in that order", () => {
    const { tracker } = makeTracker();
    const ended = replayStreamedTurns(tracker, 25);
    const kinds = ended.map((e) => e.turn?.kind).filter(Boolean);
    assert.deepEqual(kinds, ["warn", "pause"], "a warning at 10, a pause at 20, once each");
  });
});

describe("checkpoint cadence: two triggers, one checkpoint", () => {
  it("a checkpoint every fifteen turns, with its reason", () => {
    const turnBudget = createTurnBudgetWatch({ warnAt: 100, pauseAt: 150 });
    const tracker = createTurnTracker({ turnBudget });
    const ended = replayStreamedTurns(tracker, 46);
    const checkpoints = ended.map((e) => e.checkpoint).filter(Boolean);
    assert.deepEqual(
      checkpoints.map((c) => c!.turn),
      [15, 30, 45],
      "three checkpoints over forty-five closed turns",
    );
    assert.deepEqual(
      checkpoints.map((c) => c!.reason),
      ["turns", "turns", "turns"],
    );
    assert.equal(CHECKPOINT_EVERY_TURNS, 15);
  });

  it("a 105-turn session produces seven checkpoints; the real sessions produced zero", () => {
    // The report's number: `Wut-PgnwLA`, 105 turns, 0 `repo_checkpoint`. The measurement that revealed
    // the defect, replayed here.
    const turnBudget = createTurnBudgetWatch({ warnAt: 500, pauseAt: 600, cap: 1000 });
    const tracker = createTurnTracker({ turnBudget });
    const ended = replayStreamedTurns(tracker, 105);
    ended.push(...tracker.observe(result()));
    assert.equal(turnBudget.used, 105);
    assert.equal(ended.filter((e) => e.checkpoint).length, 7);
  });

  it("elapsed time triggers a checkpoint even when turns are long and rare", () => {
    // The case that cost thirty-three minutes: one turn = a ten-minute command. Three turns never
    // cross the fifteen threshold, but half an hour has passed.
    let clock = 0;
    const turnBudget = createTurnBudgetWatch({ warnAt: 100, pauseAt: 150 });
    const tracker = createTurnTracker({
      turnBudget,
      now: () => clock,
    });
    const ended: Ended[] = [];
    for (let i = 1; i <= 4; i++) {
      clock += 11 * 60_000; // eleven minutes per turn
      ended.push(...tracker.observe(streamed(`msg_${i}`, "tool_use")));
    }
    const checkpoints = ended.map((e) => e.checkpoint).filter(Boolean);
    assert.equal(
      checkpoints.length,
      3,
      "a checkpoint per long turn, although none reaches the 15th",
    );
    assert.deepEqual(
      checkpoints.map((c) => c!.reason),
      ["elapsed", "elapsed", "elapsed"],
    );
    assert.ok(checkpoints[0]!.sinceMs >= CHECKPOINT_EVERY_MS);
  });

  it("the two triggers never make TWO checkpoints for one turn", () => {
    let clock = 0;
    const turnBudget = createTurnBudgetWatch({ warnAt: 100, pauseAt: 150 });
    const tracker = createTurnTracker({
      turnBudget,
      now: () => clock,
    });
    const ended: Ended[] = [];
    for (let i = 1; i <= 20; i++) {
      clock += 30 * 60_000; // each turn ALSO crosses the time threshold
      ended.push(...tracker.observe(streamed(`msg_${i}`, "tool_use")));
    }
    const turns = ended.filter((e) => e.checkpoint).map((e) => e.checkpoint!.turn);
    assert.equal(new Set(turns).size, turns.length, "never two checkpoints on the same turn");
  });

  it("an elapsed-time checkpoint resets the turn counter, it does not add to it", () => {
    // Otherwise a long-turn session would checkpoint on time AND on the 15th turn right after.
    let clock = 0;
    const turnBudget = createTurnBudgetWatch({ warnAt: 100, pauseAt: 150 });
    const tracker = createTurnTracker({
      turnBudget,
      now: () => clock,
    });
    const ended: Ended[] = [];
    for (let i = 1; i <= 20; i++) {
      clock += i === 3 ? 11 * 60_000 : 1000;
      ended.push(...tracker.observe(streamed(`msg_${i}`, "tool_use")));
    }
    const checkpoints = ended.map((e) => e.checkpoint).filter(Boolean);
    assert.deepEqual(
      checkpoints.map((c) => [c!.turn, c!.reason]),
      [
        [2, "elapsed"],
        [17, "turns"],
      ],
    );
  });
});

describe("the runner no longer recognises a turn end itself", () => {
  // The tests above prove the tracker counts. They do NOT prove the runner uses it: exactly the gap
  // that let the 03/09 defect through, where two impeccably tested modules were called by a
  // never-true condition. This test reads the runner's CODE and requires the recognition not to be
  // back.
  const RUNNER = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../runner-payload/session-runner.mts",
  );
  /** Code only: comments TALK about `stop_reason` (the incident is told there), which is fine;
   *  what is forbidden is making it a condition again. */
  const code = readFileSync(RUNNER, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("it feeds the tracker EVERY SDK message", () => {
    assert.match(code, /turns\.observe\(msg\)/, "the message loop must go through the tracker");
  });

  it("it no longer tests `stop_reason`, the condition that switched the guardrails off", () => {
    assert.doesNotMatch(
      code,
      /stop_reason/,
      "a turn is not recognised by `stop_reason` on the stream path",
    );
  });

  it("it no longer calls the counter directly: one place counts", () => {
    assert.doesNotMatch(code, /turnBudget\.record\(/, "only turn-tracker moves the turn budget");
  });
});
