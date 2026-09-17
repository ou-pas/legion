// A session's TURN budget (v29), after losing the Channels view on 25/08: 201 turns, $32.08, cut by
// `maxTurns` the second the agent was writing its final commit.
//
// A product decision as much as a setting: an exhausted turn budget is NOT an anomaly like a stall
// or a cost drift. It is a task bigger than one run. Hence two stages that do not blend: a WARNING
// addressed to the agent, leaving it the call, then a PAUSE asking it nothing. The tests cover the
// boundaries, each stage speaking only ONCE, and inconsistent settings, which must degrade the
// guardrail without ever switching it off.
//
// The module is .mts compiled into the session image (same reason and pattern as stuck.mts),
// imported as is: THE CODE THAT RUNS is what is tested.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTurnBudgetWatch,
  DEFAULT_TURN_PAUSE,
  DEFAULT_TURN_WARN,
  SDK_TURN_CAP,
} from "../../../runner-payload/turn-budget.mjs";
import type { TurnBudgetEvent, TurnBudgetWatch } from "../../../runner-payload/turn-budget.mjs";

// Both types come from the module since lot 10. They used to be copied by hand, each call carrying
// an `as Watch`, the only option while the payload was untyped JS. A copy the compiler does not
// reread guards nothing: a field renamed in the module left it green.
type Hit = TurnBudgetEvent | null;
type Watch = TurnBudgetWatch;

/** Consumes `n` turns and returns everything the counter said along the way. */
function run(w: Watch, n: number): NonNullable<Hit>[] {
  const hits: NonNullable<Hit>[] = [];
  for (let i = 0; i < n; i++) {
    const h = w.record();
    if (h) hits.push(h);
  }
  return hits;
}

describe("createTurnBudgetWatch: two stages, not a wall", () => {
  it("says nothing while below the warning", () => {
    const w = createTurnBudgetWatch({ warnAt: 10, pauseAt: 20 });
    assert.deepEqual(run(w, 9), []);
    assert.equal(w.used, 9);
  });

  it("warns AT the threshold, not after, and only once", () => {
    const w = createTurnBudgetWatch({ warnAt: 10, pauseAt: 20 });
    const hits = run(w, 15);
    assert.equal(hits.length, 1, "a single warning over fifteen turns");
    assert.equal(hits[0]!.kind, "warn");
    assert.equal(hits[0]!.used, 10, "the threshold is reached AT the 10th turn");
  });

  it("the warning says how much is left: the number the agent can act on", () => {
    const w = createTurnBudgetWatch({ warnAt: 10, pauseAt: 20 });
    const [warn] = run(w, 10);
    assert.equal(
      warn!.left,
      10,
      "20 - 10: what is left BEFORE the pause, not before the hard wall",
    );
    assert.equal(
      warn!.cap,
      SDK_TURN_CAP,
      "the hard wall is reported too, but it is not the deadline",
    );
  });

  it("pauses at the pause threshold, once, and never before the warning", () => {
    const w = createTurnBudgetWatch({ warnAt: 10, pauseAt: 20 });
    const hits = run(w, 40);
    assert.deepEqual(
      hits.map((h) => h.kind),
      ["warn", "pause"],
      "exactly two announcements over forty turns",
    );
    assert.equal(hits[1]!.used, 20);
    assert.equal(hits[1]!.left, 0);
  });

  it("the warning comes BEFORE the pause even if both thresholds fall on the same turn", () => {
    // Real case: a `resume` restarting beyond both thresholds, or very close thresholds. The agent
    // must be told before being stopped, otherwise the pause comes without it ever having had a say,
    // exactly the wall being removed.
    const w = createTurnBudgetWatch({ warnAt: 3, pauseAt: 3 });
    const hits = run(w, 5);
    assert.equal(hits[0]!.kind, "warn", "the first word is the warning");
    assert.equal(hits[1]!.kind, "pause", "the pause follows, on the next turn");
    assert.ok(hits[1]!.used > hits[0]!.used, "they do not fall on the same turn");
  });
});

describe("createTurnBudgetWatch: an inconsistent setting degrades, it does not switch off", () => {
  it("a pause beyond the hard wall is brought back UNDER the wall", () => {
    // The defect refused: `pauseAt: 500` would silence the module and the session would go on to die
    // on `maxTurns`. A guardrail disabled by a setting is worse than none, because it reassures.
    const w = createTurnBudgetWatch({ pauseAt: 500 });
    assert.ok(w.pauseAt < w.cap, `pause ${w.pauseAt} must stay under the wall ${w.cap}`);
    assert.equal(w.pauseAt, SDK_TURN_CAP - 1);
  });

  it("a warning beyond the pause is brought back BEFORE it", () => {
    const w = createTurnBudgetWatch({ warnAt: 90, pauseAt: 20 });
    assert.ok(w.warnAt < w.pauseAt, `warn ${w.warnAt} must precede pause ${w.pauseAt}`);
    const hits = run(w, 25);
    assert.deepEqual(
      hits.map((h) => h.kind),
      ["warn", "pause"],
      "both stages still speak",
    );
  });

  it("missing or absurd thresholds fall back to the defaults", () => {
    for (const opts of [undefined, {}, { warnAt: 0, pauseAt: 0 }, { warnAt: NaN, pauseAt: NaN }]) {
      const w = createTurnBudgetWatch(opts);
      assert.equal(w.warnAt, DEFAULT_TURN_WARN, `warnAt for ${JSON.stringify(opts)}`);
      assert.equal(w.pauseAt, DEFAULT_TURN_PAUSE, `pauseAt for ${JSON.stringify(opts)}`);
    }
  });

  it("the defaults leave room to finish OR to hand over", () => {
    // A warning stuck to the wall is useless: pushing, writing the artifact and proposing the
    // re-breakdown task each cost turns. A real margin is required.
    assert.ok(
      DEFAULT_TURN_PAUSE - DEFAULT_TURN_WARN >= 20,
      "at least 20 turns between the warning and the pause",
    );
    assert.ok(
      SDK_TURN_CAP - DEFAULT_TURN_PAUSE >= 10,
      "at least 10 turns between the pause and the hard wall",
    );
  });
});
