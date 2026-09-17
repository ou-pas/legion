// Protects:
//
//  1. one line per entry, even for a multi-line message, so `grep` still finds it;
//  2. `LEGION_LOG_LEVEL` filters, and an unknown value does not silence the log;
//  3. `LEGION_LOG_FORMAT=json` prints a parsable object;
//  4. warn and error go to stderr, debug and info to stdout.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createLogger } from "./log.js";

/** Captures both streams' writes during a call. */
function capture(run: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => (out.push(String(chunk)), true);
  process.stderr.write = (chunk: string | Uint8Array) => (err.push(String(chunk)), true);
  try {
    run();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return { out, err };
}

afterEach(() => {
  delete process.env.LEGION_LOG_LEVEL;
  delete process.env.LEGION_LOG_FORMAT;
});

describe("createLogger", () => {
  it("writes one line with source, level and fields", () => {
    const { out } = capture(() =>
      createLogger("runner").info("session started", { sessionId: "s1" }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.endsWith("\n"), true);
    assert.equal(out[0]!.trimEnd().includes("\n"), false);
    assert.match(out[0]!, /info\s+\[runner\] session started sessionId="s1"\n$/);
  });

  it("flattens a multi-line message into one line", () => {
    const { err } = capture(() => createLogger("docker").error("failure\n  at foo\n  at bar"));
    assert.equal(err.length, 1);
    assert.equal(err[0]!.trimEnd().includes("\n"), false);
    assert.match(err[0]!, /failure at foo at bar/);
  });

  it("sends warn and error to stderr, debug and info to stdout", () => {
    process.env.LEGION_LOG_LEVEL = "debug";
    const log = createLogger("x");
    const { out, err } = capture(() => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    });
    assert.equal(out.length, 2);
    assert.equal(err.length, 2);
  });

  it("filters below the requested level", () => {
    process.env.LEGION_LOG_LEVEL = "warn";
    const log = createLogger("x");
    const { out, err } = capture(() => {
      log.debug("d");
      log.info("i");
      log.warn("w");
    });
    assert.deepEqual(out, []);
    assert.equal(err.length, 1);
  });

  it("hides debug by default, not info", () => {
    const log = createLogger("x");
    const { out } = capture(() => {
      log.debug("d");
      log.info("i");
    });
    assert.equal(out.length, 1);
  });

  it("falls back to info on an unknown LEGION_LOG_LEVEL: a typo silences nothing", () => {
    process.env.LEGION_LOG_LEVEL = "verbose";
    const { out } = capture(() => createLogger("x").info("i"));
    assert.equal(out.length, 1);
  });

  it("prints parsable JSON with LEGION_LOG_FORMAT=json", () => {
    process.env.LEGION_LOG_FORMAT = "json";
    const { err } = capture(() => createLogger("queue").warn("requeued", { taskId: "t1" }));
    const entry = JSON.parse(err[0]!) as Record<string, unknown>;
    assert.equal(entry.level, "warn");
    assert.equal(entry.source, "queue");
    assert.equal(entry.message, "requeued");
    assert.equal(entry.taskId, "t1");
    assert.equal(typeof entry.ts, "string");
  });
});
