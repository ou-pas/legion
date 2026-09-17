// Work that died with the container on a requested stop.
//
// The runner listened to NO signal until 05/09. A stop from the operator destroyed the container,
// and `pushRepos` only runs when the message loop exits, never reached on an external death. The
// last net was the periodic checkpoint (turn-tracker.mts: fifteen turns or ten minutes), so up to
// that much uncommitted work vanished without a trace. Worse, `node` is PID 1 in the image (the
// entrypoint does `exec "$@"`), and Linux does not deliver a signal to a handler-less PID 1: a
// `docker stop` had NO effect before its grace period, then SIGKILL.
//
// The fix has two halves that do not see each other: `docker.ts` SENDS SIGTERM with thirty seconds
// of grace before `rm -f`; `session-runner.mts` HEARS it and pushes the work through the exit path
// the watchers (inbox, stall, budgets, quota, pause) already use. This file checks the second half.
//
// Why a regex on the source rather than an import: `session-runner.mts` reads its environment and
// calls `process.exit` on load, so it cannot be imported (same setup as push-repos.test.ts).
//
// Not proven here: that Docker delivers the signal, that the SDK abort drops the loop into the
// `catch`, that the push fits in twenty seconds. A test mounting a container and sending SIGTERM
// would prove that; it does not exist yet. This one only stops the shape from silently
// disappearing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUNNER = resolve(ROOT, "runner-payload/session-runner.mts");

/** The grace `docker stop -t` grants on the server side: the runner's bound must fit inside. */
const DOCKER_STOP_GRACE_MS = 30_000;

describe("requested stop: the runner hears SIGTERM and puts the work in safety", () => {
  const src = readFileSync(RUNNER, "utf8");
  const real = src.slice(src.indexOf("async function runReal()"));
  /** The block starts at its bound: the constant precedes the flag and the function. */
  const handlerAt = real.indexOf("const STOP_GRACE_MS");
  const queryAt = real.indexOf("const q = query(");
  /** The handler, from its bound to the SDK call that follows it. */
  const handler = real.slice(handlerAt, queryAt);
  /** The body without its comments: they QUOTE what is forbidden to say why. */
  const code = handler.replace(/^\s*\/\/.*$/gm, "");

  it("a handler exists, and it is the SAME for SIGTERM and SIGINT", () => {
    assert.ok(
      handlerAt > 0,
      "`STOP_GRACE_MS` not found in runReal: the landmark moved, or the handler disappeared",
    );
    assert.match(
      code,
      /function stopRequested\(signal[^)]*\)/,
      "the handler is a named function receiving the signal name",
    );
    assert.match(
      code,
      /process\.on\("SIGTERM",\s*stopRequested\)/,
      "SIGTERM must be listened to (it is what `docker stop` sends)",
    );
    assert.match(
      code,
      /process\.on\("SIGINT",\s*stopRequested\)/,
      "SIGINT too (Ctrl-C on the dev ProcessRunner)",
    );
    assert.equal(
      (src.match(/process\.on\("SIG/g) ?? []).length,
      2,
      "two listeners, not one more: a second handler would be a second exit path",
    );
  });

  it("is installed AFTER setupRepos and BEFORE query(), where `repos`, `abort` and `pausing` exist", () => {
    const setupAt = real.indexOf("repos = await setupRepos(");
    assert.ok(setupAt > 0 && queryAt > 0, "both landmarks must exist");
    assert.ok(
      handlerAt > setupAt,
      "before the clone there is nothing to save, and `repos` does not exist",
    );
    assert.ok(handlerAt < queryAt, "after the first turn there is already work to lose");
    // No `await` between `process.on` and `query()`: a signal cannot be handled before the SDK has
    // installed its abort listener, otherwise `abort.abort()` would fall into the void.
    const between = code.slice(code.indexOf('process.on("SIGTERM"'));
    assert.doesNotMatch(
      between,
      /\bawait\b/,
      "no `await` between installing the handler and the SDK call",
    );
  });

  it("joins the `pausing` path, the only one that pushes then exits without going through `finally`", () => {
    // The gesture of the five other watchers: raise `pausing`, abort. The `catch` does the push.
    assert.match(code, /pausing = true;/, "the handler must raise `pausing`");
    // `abortNow` rather than `abort.abort()` since 14/09: the controller is fired through a single
    // passage that REMEMBERS which of the three paths armed it, because once cut it no longer says,
    // and that silence made tool cut-offs unexplainable.
    assert.match(
      code,
      /abortNow\("stop"\);/,
      "and abort the SDK: that is what stops the CLI before the commit",
    );
    // And no checkpoint of its own: git would race on the same index as the still-living agent.
    assert.doesNotMatch(
      code,
      /checkpointRepos\(|pushRepos\(/,
      "the handler does not push itself, it leaves that to the `catch`",
    );
    // The `catch`: `pausing` → `pushRepos` → `flushOutbox` → `process.exit(0)`. The exit skips the
    // `finally` and the end-of-loop `pushRepos`: that guarantees ONE push, not two.
    //
    // `flushOutbox` came in on 08/09, and the order matters: the event queue is IN MEMORY, so this
    // container is the only one carrying its trace. Exiting without flushing loses the last `result`,
    // and the sweep then files a successful session as a container gone without a reported result.
    const catchAt = real.indexOf("} catch (err) {", queryAt);
    const finallyAt = real.indexOf("} finally {", catchAt);
    const catchBlock = real.slice(catchAt, finallyAt);
    assert.match(
      catchBlock,
      /if \(pausing[\s\S]{0,900}await pushRepos\([^)]*\);[\s\S]{0,400}process\.exit\(0\);/,
      "on `pausing`, the catch pushes then exits, in that order",
    );
    assert.match(
      catchBlock,
      /await pushRepos\([^)]*\);[\s\S]{0,400}await flushOutbox\(\);[\s\S]{0,200}process\.exit\(0\);/,
      "the trace leaves BEFORE the exit: the queue is in memory, this container is the only one carrying it",
    );
    const tail = real.slice(finallyAt);
    assert.equal(
      (tail.match(/await pushRepos\(/g) ?? []).length,
      1,
      "the end-of-loop push exists once, after the finally, never reached when the catch already exited",
    );
  });

  it("is idempotent: a second signal during the save restarts nothing", () => {
    assert.match(code, /let stopping = false;/, "a flag, set once");
    assert.match(
      code,
      /function stopRequested\(signal[^)]*\) \{\s*if \(stopping\) return;\s*stopping = true;/,
      "and tested FIRST in the handler, before any effect",
    );
  });

  it("is bounded below the Docker grace period, and says so before exiting", () => {
    const raw = /const STOP_GRACE_MS = (\d[\d_]*);/.exec(code)?.[1];
    assert.ok(raw, "the bound must be a named constant");
    const grace = Number(raw.replace(/_/g, ""));
    assert.ok(
      grace < DOCKER_STOP_GRACE_MS,
      `${grace} ms must leave room under the ${DOCKER_STOP_GRACE_MS} ms of \`docker stop -t\``,
    );
    assert.ok(grace >= 10_000, "and stay long enough for a real push");
    assert.match(
      code,
      /setTimeout\(async \(\) => \{[\s\S]{0,600}process\.exit\(0\);[\s\S]{0,40}\}, STOP_GRACE_MS\)/,
      "at the deadline, exit",
    );
    assert.match(
      code,
      /Promise\.race\(\[[\s\S]{0,400}report\("run_warning"[\s\S]{0,400}sleep\(/,
      "after SAYING so, but without waiting for a silent control plane",
    );
    assert.match(
      code,
      /\.unref\?\.\(\)/,
      "the timer does not hold a process that already finished",
    );
  });

  it("reports the stop to the control plane through the existing log, without blocking the abort", () => {
    // `void report(...)`: the event goes to the outbox, the abort does not wait for it. An `await`
    // here would hold the abort for the twenty seconds of grace; that is the invariant, only reachable
    // by reading the source (the handler cannot be instantiated alone).
    //
    // Read without its layout (14/09): `runner-payload/` went under the formatter, and a regex that
    // counts spaces fails on a line break nobody chose.
    const flat = code.replace(/\s+/g, " ");
    assert.match(
      flat,
      /void report\("run_warning", \{ message: `stop requested \(\$\{signal\}\)/,
      "a `run_warning` naming the signal, fire-and-forget",
    );
    const reportAt = code.indexOf("void report(");
    const abortAt = code.indexOf('abortNow("stop")');
    assert.ok(
      reportAt > 0 && abortAt > reportAt,
      "the report is placed before the abort, and does not hold it",
    );
  });
});
