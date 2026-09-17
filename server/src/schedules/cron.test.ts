// The cron is pure, so it is tested entirely. Edge cases are what count: a cron off by a day is
// invisible, it just runs the agent at the wrong time.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronMatches, nextRun, nextRunOf, parseCron } from "./cron.js";

const at = (iso: string) => new Date(iso).getTime();
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("parsing an expression", () => {
  it("the five forms of a field", () => {
    assert.deepEqual([...parseCron("5 * * * *")!.minute], [5]);
    assert.deepEqual([...parseCron("1,15 * * * *")!.minute], [1, 15]);
    assert.deepEqual([...parseCron("0-3 * * * *")!.minute], [0, 1, 2, 3]);
    assert.deepEqual([...parseCron("*/15 * * * *")!.minute], [0, 15, 30, 45]);
    assert.deepEqual([...parseCron("0-30/10 * * * *")!.minute], [0, 10, 20, 30]);
  });

  it("Sunday is written 0 or 7", () => {
    assert.deepEqual([...parseCron("0 0 * * 7")!.dayOfWeek], [0]);
    assert.deepEqual([...parseCron("0 0 * * 0")!.dayOfWeek], [0]);
  });

  it("what is not an expression is REFUSED, never guessed", () => {
    for (const e of [
      "",
      "* * * *",
      "* * * * * *",
      "60 * * * *",
      "* 24 * * *",
      "* * 0 * *",
      "* * * 13 *",
      "* * * * 8",
      "@daily",
      "5-1 * * * *",
      "*/0 * * * *",
      "a * * * *",
      "* * * * *,",
    ])
      assert.equal(parseCron(e), null, e);
  });
});

describe("the next run", () => {
  it("is STRICTLY after the given instant", () => {
    // Exactly on a match we return the NEXT one, or a tick in the same minute would run the task
    // twice.
    assert.equal(
      iso(nextRunOf("0 9 * * *", at("2026-08-26T09:00:00Z"))),
      "2026-08-27T09:00:00.000Z",
    );
  });

  it("every quarter hour", () => {
    assert.equal(
      iso(nextRunOf("*/15 * * * *", at("2026-08-26T09:07:30Z"))),
      "2026-08-26T09:15:00.000Z",
    );
  });

  it("a weekday: next Monday 9:00", () => {
    // 26/08/2026 is a Wednesday.
    assert.equal(
      iso(nextRunOf("0 9 * * 1", at("2026-08-26T12:00:00Z"))),
      "2026-08-31T09:00:00.000Z",
    );
  });

  it("crosses a shorter month", () => {
    assert.equal(
      iso(nextRunOf("0 0 31 * *", at("2026-04-15T00:00:00Z"))),
      "2026-05-31T00:00:00.000Z",
    );
  });

  it("finds a 29 February", () => {
    assert.equal(
      iso(nextRunOf("0 0 29 2 *", at("2026-03-01T00:00:00Z"))),
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("a date that does NOT exist returns null instead of looping", () => {
    assert.equal(nextRunOf("0 0 30 2 *", at("2026-01-01T00:00:00Z")), null);
  });

  it("an invalid expression returns null", () => {
    assert.equal(nextRunOf("whatever", at("2026-01-01T00:00:00Z")), null);
  });
});

describe("day-of-month AND day-of-week: an OR, not an AND", () => {
  // The POSIX rule. `0 0 1 * 1` fires on the 1st AND every Monday; reading it as AND would
  // silently miss most runs.
  const spec = parseCron("0 0 1 * 1")!;

  it("the 1st of the month, even if not a Monday", () => {
    assert.equal(cronMatches(spec, new Date("2026-07-01T00:00:00Z")), true); // a Wednesday
  });

  it("a Monday, even if not the 1st", () => {
    assert.equal(cronMatches(spec, new Date("2026-08-31T00:00:00Z")), true);
  });

  it("Tuesday the 12th: neither", () => {
    assert.equal(cronMatches(spec, new Date("2026-05-12T00:00:00Z")), false);
  });

  it("when only ONE of the two is restricted, the other does not join in", () => {
    const dowOnly = parseCron("0 0 * * 1")!;
    assert.equal(cronMatches(dowOnly, new Date("2026-07-01T00:00:00Z")), false); // Wednesday
    const domOnly = parseCron("0 0 1 * *")!;
    assert.equal(cronMatches(domOnly, new Date("2026-08-31T00:00:00Z")), false); // Monday 31st
  });
});

describe("everything is UTC, and nothing shifts it", () => {
  it("the European summer-time switch does not move the instant", () => {
    // On 28-29 March 2026 Europe goes from UTC+1 to UTC+2. A local-time cron would skip or double
    // a run; in UTC there is nothing to skip.
    const before = nextRun(parseCron("30 2 * * *")!, at("2026-03-28T12:00:00Z"));
    assert.equal(iso(before), "2026-03-29T02:30:00.000Z");
    assert.equal(iso(nextRun(parseCron("30 2 * * *")!, before!)), "2026-03-30T02:30:00.000Z");
  });
});
