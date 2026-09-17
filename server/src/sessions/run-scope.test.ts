// The current run, and why it is not read over the whole session (lot 11).
//
// The 02/09 incident on Wv8klSI15U1B: a quota rejection at 10:51 haunted every CLEAN exit of the
// following runs, 24 resumes in a loop, the agent concluding in 7 s and the manager putting it back
// to sleep out of quota. The fix reads an exit verdict only from the LAST move to `running`; that
// bound is computed here, from an array rather than a database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { latestRunningAt } from "./run-scope.js";

const at = (ms: number, payload: string) => ({ at: new Date(ms), payload });
const running = (ms: number) => at(ms, '{"status":"running","runtime":"legion-session-x"}');

describe("latestRunningAt: the current run's bound", () => {
  it("returns 0 on an empty trace: readers fall back to the whole session", () => {
    assert.equal(latestRunningAt([]), 0);
  });

  it("returns 0 when the session never reached `running`", () => {
    // A start that never completes sets no bound, the pre-fix behaviour kept on purpose: better read
    // too wide than lose a verdict.
    assert.equal(
      latestRunningAt([at(10, '{"status":"starting"}'), at(20, '{"status":"failed"}')]),
      0,
    );
  });

  it("returns the time of the only move to `running`", () => {
    assert.equal(latestRunningAt([at(10, '{"status":"starting"}'), running(20)]), 20);
  });

  it("returns the LAST move to `running`: the whole point of the 02/09 fix", () => {
    // Three runs: the first was rejected on quota, the next two are resumes. Without this bound the
    // first run's old `rejected` put every clean exit back to sleep.
    assert.equal(
      latestRunningAt([
        running(100),
        at(150, '{"status":"waiting","reason":"out of quota"}'),
        running(200),
        at(250, '{"status":"waiting"}'),
        running(300),
      ]),
      300,
    );
  });

  it("does NOT assume the trace is sorted: the maximum wins, not the last element", () => {
    assert.equal(latestRunningAt([running(300), running(100), running(200)]), 300);
  });

  it("ignores a status that CONTAINS the word without being `running`", () => {
    // The test is a substring on the machine JSON `publish` writes, so on `"status":"running"`
    // exactly, not on the word "running" anywhere.
    assert.equal(
      latestRunningAt([at(10, '{"status":"failed","reason":"not running anymore"}')]),
      0,
    );
  });
});
