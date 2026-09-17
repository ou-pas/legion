// The block the agent reads when the CI is red:
//
//  1. The output is verbatim and bounded: the log's tail, never a summary, and a line cut in the
//     middle is marked with `…` so it does not read as a whole log line.
//  2. A missing log cancels nothing: the block names the missing scope and points at the job URL.
//  3. Proof must be positive: "the test is not in my diff" proves nothing, and the block must say
//     so, or the agent takes the file's absence as an alibi.
//  4. Out of scope is not silence, and changing nothing is allowed: both sentences must be there,
//     or the agent invents a fix to justify its session.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ciFixBlock, ciRefusal, logTail, LOG_TAIL_CHARS } from "./ci-brief.js";

const JOB = {
  id: "42",
  name: "tests (node 20)",
  url: "https://github.com/o/r/actions/runs/9/job/42",
};
const base = {
  changeRequestLabel: "pull request",
  repoName: "backend",
  number: 565,
  failing: [JOB],
  log: "FAIL src/a.test.ts\nAssertionError: expected 1 to equal 2",
  files: [{ path: "src/a.ts", status: "modified" }],
};

describe("logTail: the bounded tail, a cut line marked", () => {
  it("returns the whole log when it fits under the cap", () => {
    assert.deepEqual(logTail("short\n"), { text: "short", truncated: false });
  });

  // Measured on a real job (vitejs/vite #23453, 135,283 characters): dropping the cut line brought
  // the tail from 12,000 down to 4,037 characters, because one log line holds tens of thousands.
  // The `…` keeps the budget and signals the cut.
  it("keeps the whole requested budget and marks the cut line", () => {
    const log = ["very long first line", "middle", "last line"].join("\n");
    const { text, truncated } = logTail(log, 20);
    assert.equal(truncated, true);
    assert.equal(text.length, 21, "the 20 requested characters, plus the mark");
    assert.ok(text.startsWith("…"), text);
    assert.ok(text.endsWith("last line"), text);
  });

  it("normalises Windows line endings: a Windows runner does not return another format", () => {
    assert.equal(logTail("a\r\nb\r\n").text, "a\nb");
  });

  // Measured on the same job: 135,283 raw characters, 54,201 once colours were removed. 60% of the
  // log was escape codes, and the tail returned mush.
  it("strips the runner's colours: 60% of a vitest job's log", () => {
    const esc = String.fromCharCode(27);
    assert.equal(logTail(`${esc}[31mFAIL${esc}[39m src/a.ts`).text, "FAIL src/a.ts");
  });
});

describe("ciFixBlock: the job, its verbatim log, the diff, and the scope", () => {
  it("names the job, its URL, and quotes the output without summarising", () => {
    const block = ciFixBlock(base);
    assert.ok(block.includes("### Failing job: tests (node 20)"), block);
    assert.ok(block.includes(JOB.url));
    assert.ok(
      block.includes("AssertionError: expected 1 to equal 2"),
      "the output is there, word for word",
    );
    assert.ok(block.includes("pull request #565"));
    assert.ok(block.includes('repo "backend"'));
  });

  it("says the log is bounded when it is, and points at the URL", () => {
    const block = ciFixBlock({ ...base, log: "x".repeat(LOG_TAIL_CHARS + 10) });
    assert.ok(block.includes(`last ${LOG_TAIL_CHARS} characters`), block.slice(0, 400));
  });

  it("a missing log names the missing scope and does not give up", () => {
    const block = ciFixBlock({ ...base, log: null });
    assert.ok(block.includes("`actions:read`"), block);
    assert.ok(block.includes("This is not a reason to stop"), block);
  });

  it("other red jobs are named with their URL, without their log", () => {
    const block = ciFixBlock({
      ...base,
      failing: [JOB, { id: "43", name: "lint", url: "https://x/43" }],
    });
    assert.ok(block.includes("### Other failing jobs"));
    assert.ok(block.includes("- lint — https://x/43"));
  });

  it("lists the change request's files: without them the agent cannot judge its scope", () => {
    assert.ok(ciFixBlock(base).includes("- src/a.ts (modified)"));
    const unread = ciFixBlock({ ...base, files: null });
    assert.ok(unread.includes("git diff origin/<base>...HEAD --name-status"), unread);
  });

  it("demands positive proof: the file's absence from the diff is not an alibi", () => {
    const block = ciFixBlock(base);
    assert.ok(block.includes("PROOF MUST BE POSITIVE"), block);
    assert.ok(block.includes("ON THE BASE BRANCH"), block);
  });

  it("out of scope = a filed task, never silence; and changing nothing is allowed", () => {
    const block = ciFixBlock(base);
    assert.ok(block.includes("propose_task"), block);
    assert.ok(block.includes("You are allowed to change nothing"), block);
    assert.ok(block.includes("Do not invent a fix"), block);
  });

  it("forbids disabling the test and widening a catch, in writing", () => {
    const block = ciFixBlock(base);
    assert.ok(block.includes("Never disable, skip, or delete the failing test"), block);
    assert.ok(block.includes("Never widen a `catch`"), block);
  });
});

describe("ciRefusal: what each CI state refuses", () => {
  it("tells passing, pending and unknown apart, never treating uncertainty as passing", () => {
    assert.match(ciRefusal("passing", "pull request", 7), /is no longer failing/);
    assert.match(ciRefusal("pending", "pull request", 7), /has not finished running/);
    assert.match(ciRefusal("unknown", "merge request", 7), /uncertainty/);
  });
});
