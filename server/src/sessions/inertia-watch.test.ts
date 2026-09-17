// The turn pause becomes an inertia pause (10/09, five-round interview with the operator).
//
// Until 11/09 these tests pinned: at 175 turns (the then turn-budget pause threshold), the session
// stops ONLY if it produced nothing for thirty turns. Since then inertia no longer waits for the
// budget's pause turn (`session-runner.mts` asks at EVERY turn), so the criteria below replay at an
// arbitrary check turn, far from any turn-budget threshold, to make clear this module knows none
// (see criterion 5).
//
// "Moving" is not the agent's opinion: it is a commit pushed by a checkpoint OR a successful tool
// write, the two signals the runner already reads at turn end. The checker is the code, because an
// agent going in circles is precisely the one that believes it moves; that false positive already
// cost the token guardrail, removed on 08/09.
//
// The module is .mts compiled into the session image (same pattern as turn-budget-watch.test.ts):
// imported as is, THE CODE THAT RUNS is what is tested.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInertiaWatch, INERTIA_STALE_TURNS } from "../../../runner-payload/inertia.mjs";

// The type is derived from the module since lot 10. The verdict and watcher shape used to be copied
// by hand here, each call carrying an `as Watch`, the only option while `inertia.mjs` had no types.
// A copy the compiler does not reread guards nothing: a field renamed in the module left it green.
type Watch = ReturnType<typeof createInertiaWatch>;

/** An arbitrary check turn, far from the turn-budget thresholds (300/375/400), precisely to prove
 *  `verdict()` knows none. Before 11/09 these tests probed at the pause turn (175 then), true ONLY
 *  because the pause read this verdict at that turn, not because the module required it. */
const CHECK_AT = 70;

/** Runs the session from `from` to `to` producing nothing. The watcher is fed at EVERY turn, as in
 *  `session-runner.mts`: that makes inertia measurable without a clock. */
function idle(w: Watch, from: number, to: number): void {
  for (let t = from; t <= to; t++) w.record({ turn: t });
}

describe("createInertiaWatch: length is not a fault, inertia is", () => {
  it("the default threshold is the module's, not a copied number", () => {
    assert.equal(createInertiaWatch().staleTurns, INERTIA_STALE_TURNS);
    assert.equal(INERTIA_STALE_TURNS, 30);
  });

  it("criterion 1: at the check turn with a commit pushed five turns earlier, the session is moving", () => {
    const w = createInertiaWatch();
    idle(w, 1, CHECK_AT - 6);
    w.record({ turn: CHECK_AT - 5, commits: 1 });
    idle(w, CHECK_AT - 4, CHECK_AT);
    const v = w.verdict(CHECK_AT);
    assert.equal(v.inert, false, "five turns after a push is not inertia");
    assert.equal(v.commits, 1);
    assert.equal(v.lastCommitTurn, CHECK_AT - 5);
    assert.equal(v.idleTurns, 5);
  });

  it("criterion 2: at the check turn with no commit or write for thirty-five turns, inertia, and the measurement names it", () => {
    const w = createInertiaWatch();
    const sinceTurn = CHECK_AT - 35;
    idle(w, 1, sinceTurn - 1);
    w.record({ turn: sinceTurn, writeVersion: 12 });
    idle(w, sinceTurn + 1, CHECK_AT);
    const v = w.verdict(CHECK_AT);
    assert.equal(v.inert, true);
    assert.equal(v.sinceTurn, sinceTurn, "the question must be able to say SINCE WHICH TURN");
    assert.equal(v.idleTurns, 35);
    assert.equal(v.writes, 12);
    assert.equal(v.commits, 0);
  });

  it("criterion 3: a successful write at turn 174 cancels the accumulated inertia", () => {
    const w = createInertiaWatch();
    idle(w, 1, 173);
    assert.equal(w.verdict(173).inert, true, "173 turns producing nothing: inert");
    // `stuck.stateVersion` moves one step at each successful write: that counter is what is reported,
    // never a difference computed by the caller.
    w.record({ turn: 174, writeVersion: 1 });
    const v = w.verdict(174);
    assert.equal(v.inert, false);
    assert.equal(v.sinceTurn, 174);
    assert.equal(v.writes, 1);
  });

  it("writes accumulate across turns without ever recounting old ones", () => {
    const w = createInertiaWatch();
    w.record({ turn: 5, writeVersion: 3 });
    w.record({ turn: 6, writeVersion: 3 });
    w.record({ turn: 7, writeVersion: 8 });
    assert.equal(w.writes, 8);
    assert.equal(w.lastProgressTurn, 7, "a turn that does not move the counter produces nothing");
  });

  it("a checkpoint pushing nothing does not move the session", () => {
    const w = createInertiaWatch();
    w.record({ turn: 10, commits: 0 });
    idle(w, 11, 45);
    assert.equal(w.verdict(45).inert, true);
    assert.equal(w.verdict(45).commits, 0);
    assert.equal(w.lastCommitTurn, null);
  });

  it("criterion 4: no writable repository, never inertia, whatever the number of turns", () => {
    const w = createInertiaWatch({ writable: false });
    idle(w, 1, 400);
    const v = w.verdict(400);
    assert.equal(v.inert, false, "thirty turns of reading code are normal work");
    assert.equal(v.writable, false);
    // The MEASUREMENT stays right: what is switched off is the consequence, not the measurement.
    assert.equal(v.idleTurns, 400);
    assert.equal(v.sinceTurn, 0);
  });

  // The missing test (11/09): proof that inertia is true FROM the threshold, without waiting for a
  // pause turn that does not even exist in this module. A session inert at turn 70 must be asked at
  // turn 70, not at turn 375, which does not exist here.
  it("criterion 5: inert from turn 70, without waiting for a pause turn at 375 this module ignores", () => {
    const w = createInertiaWatch();
    idle(w, 1, 39); // nothing since turn 0: forty turns of inertia already accumulated
    const v = w.verdict(70);
    assert.equal(v.inert, true, "70 - 0 = 70 turns of inertia, well above the threshold of 30");
    assert.equal(v.turn, 70);
    assert.equal(v.idleTurns, 70);
    // No turn beyond 70 was fed: if `verdict()` needed a pause turn to decide, this test would fail
    // for not having reached it.
  });

  it("the threshold is tunable, and an absurd setting falls back to the default rather than disarming the guardrail", () => {
    assert.equal(createInertiaWatch({ staleTurns: 5 }).staleTurns, 5);
    for (const bad of [0, -3, Number.NaN, undefined])
      assert.equal(
        createInertiaWatch({ staleTurns: bad as number }).staleTurns,
        INERTIA_STALE_TURNS,
        `a threshold of ${String(bad)} must degrade to the default, never disarm`,
      );
  });
});
