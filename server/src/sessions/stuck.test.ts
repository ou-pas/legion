// A stall detector firing wrongly is WORSE than none: it interrupts healthy work and ends up
// disabled. Every test here is about the line between "it loops" and "it works", i.e. the clause
// "with nothing changed between two attempts", the module's whole value.
//
// The module is .mts compiled into the session image, imported as is: THE CODE THAT RUNS is what is
// tested.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStuckWatch, STUCK_FAILS, STUCK_TOTAL } from "../../../runner-payload/stuck.mjs";
import type { StuckHit } from "../../../runner-payload/stuck.mjs";

// Both types are derived from the module since lot 10. They used to be copied by hand, each call
// carrying an `as Watch`, the only option while `stuck.mjs` had no types. A copy the compiler does
// not reread guards nothing: a field renamed in the module left the copy green.
type Hit = StuckHit | null;
type Watch = ReturnType<typeof createStuckWatch>;

const fail = (w: Watch, tool = "Bash", input = '{"command":"pnpm test"}'): Hit =>
  w.record({ tool, input, ok: false });
const pass = (w: Watch, tool = "Bash", input = '{"command":"pnpm test"}'): Hit =>
  w.record({ tool, input, ok: true });

describe("createStuckWatch", () => {
  it("says nothing while below the threshold", () => {
    const w = createStuckWatch();
    for (let i = 0; i < STUCK_FAILS - 1; i++) assert.equal(fail(w), null, `failure ${i + 1}`);
  });

  it("reports at the Nth identical failure, naming the call", () => {
    const w = createStuckWatch();
    let hit: Hit = null;
    for (let i = 0; i < STUCK_FAILS; i++) hit = fail(w);
    assert.ok(hit, "the threshold must fire");
    assert.equal(hit.fails, STUCK_FAILS);
    assert.equal(hit.tool, "Bash");
    assert.match(hit.reason, /identical failures/);
  });

  it("does NOT report when the agent edits between failures: that is work", () => {
    // The legitimate scenario: red test → fix → red test → fix… Each successful write moves the state,
    // so attempts do not accumulate.
    const w = createStuckWatch();
    for (let i = 0; i < STUCK_FAILS * 3; i++) {
      assert.equal(fail(w), null, `failure ${i + 1} after an edit`);
      assert.equal(pass(w, "Edit", `{"file":"a.ts","n":${i}}`), null);
    }
    assert.equal(w.stateVersion, STUCK_FAILS * 3, "each successful write moves the state");
  });

  it("a FAILED write does not move the state, otherwise nothing would ever be detected", () => {
    const w = createStuckWatch();
    let hit: Hit = null;
    for (let i = 0; i < STUCK_FAILS; i++) hit = fail(w, "Write", '{"file":"/forbidden"}');
    assert.ok(hit, "a Write failing in a loop is a stall like any other");
    assert.equal(w.stateVersion, 0);
  });

  it("DIFFERENT calls do not add up", () => {
    const w = createStuckWatch();
    for (let i = 0; i < STUCK_TOTAL * 2; i++)
      assert.equal(fail(w, "Bash", `{"command":"echo ${i}"}`), null, `unique call ${i}`);
  });

  it("also catches a loop of calls that all SUCCEED", () => {
    // Rereading the same file forever does not move anything: no failure, but a stall.
    const w = createStuckWatch();
    let hit: Hit = null;
    for (let i = 0; i < STUCK_TOTAL; i++) hit = pass(w, "Read", '{"file_path":"/a.ts"}');
    assert.ok(hit);
    assert.equal(hit.fails, 0);
    assert.match(hit.reason, /identical calls/);
  });

  it("does not ask again in bursts: the counter restarts after a report", () => {
    // Without forgetting the key, every following call would fire again, and the human would get a
    // question per turn.
    const w = createStuckWatch();
    for (let i = 0; i < STUCK_FAILS; i++) fail(w);
    assert.equal(fail(w), null, "the call right after the report must be silent");
  });

  it("thresholds are tunable, so a chatty agent can be more tolerant", () => {
    const w = createStuckWatch({ fails: 2 });
    assert.equal(fail(w), null);
    assert.ok(fail(w), "second failure = threshold reached");
  });

  // The 08/09 false positive, on AI-2200. The task was translating 16 namespaces into two languages;
  // the agent wrote its instructions to a file and started thirteen subagents whose prompt began with
  // "Read /tmp/translate-rules.md first". All thirteen obeyed. The tenth read reached STUCK_TOTAL,
  // the session was paused seven seconds after the fan-out started, and all the subagents' work died
  // with the container.
  //
  // The detector was not counting repetitions but subagents each doing the same thing once. A fan-out
  // with a shared instructions file triggered it MECHANICALLY, the price of the "same call" clause
  // applied to a stream where the SDK mixes subagents into the main thread.
  describe("subagents", () => {
    const subRead = (w: Watch): Hit =>
      w.record({
        tool: "Read",
        input: '{"file_path":"/tmp/translate-rules.md"}',
        ok: true,
        sub: true,
      });

    it("N subagents opening with the same call are NOT a stall", () => {
      const w = createStuckWatch();
      for (let i = 0; i < STUCK_TOTAL * 3; i++)
        assert.equal(subRead(w), null, `subagent ${i + 1} reading the shared instructions`);
    });

    it("but their writes move the state, like any write", () => {
      // A parent waiting for its fan-out by polling the disk must not be punished for patience: what
      // subagents write IS progress, and it resets its counters.
      const w = createStuckWatch();
      for (let i = 0; i < STUCK_TOTAL - 1; i++)
        assert.equal(pass(w, "Read", '{"file_path":"/a.ts"}'), null);
      assert.equal(
        w.record({ tool: "Write", input: '{"file":"/fr/tickets.json"}', ok: true, sub: true }),
        null,
      );
      assert.equal(w.stateVersion, 1, "a subagent's write moves the state");
      assert.equal(
        pass(w, "Read", '{"file_path":"/a.ts"}'),
        null,
        "the parent's counters restarted",
      );
    });

    it("the main thread is still watched", () => {
      const w = createStuckWatch();
      let hit: Hit = null;
      for (let i = 0; i < STUCK_TOTAL; i++) hit = pass(w, "Read", '{"file_path":"/a.ts"}');
      assert.ok(hit, "without `sub`, the previous rule does not change one bit");
    });
  });
});
