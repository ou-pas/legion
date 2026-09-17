// The pipe is not the session (01/09, multi-machine work, slice 05). One trap and one promise.
//
// The trap: `docker wait` answers on TWO channels carrying the same numbers. When all is well, the
// CLI exits 0 and WRITES the container's code on stdout, so a container that exited 255 gives
// `code 0, stdout "255"`: a container end. When the transport breaks, ssh returns 255, but the
// docker CLI does NOT return that code: it exits 1 and copies its connection helper's code into its
// message. Confusing the two either kills a live session or waits forever for a dead container.
//
// The promise: on a transport break, probe again and reattach to the same container, the approach
// `recoverOrphanSessions` has applied at boot since 20/08, applied here while the session lives.
// When the machine does not come back, the failure says "host unreachable", where to look.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DockerResult } from "../../shared/docker-exec.js";
import {
  HOST_PROBE_ATTEMPTS,
  REATTACH_MAX,
  readWaitOutcome,
  waitWithReattach,
} from "./wait-reattach.js";

const CONTAINER = "legion-session-abc";
/** The tests' clock: the loop really sleeps in production, never here. */
const noNap = async (): Promise<void> => {};

/** The message the docker CLI really produces when its ssh helper fails. Copied verbatim (one long
 *  line) because it is the classifier's ONLY input: rewriting it neatly would test a CLI that does
 *  not exist. */
const SSH_DOWN: DockerResult = {
  code: 1,
  stdout: "",
  stderr:
    'error during connect: Get "http://docker.example.com/v1.47/containers/legion-session-abc/wait":' +
    " command [ssh -l operator -- 192.168.1.20 docker system dial-stdio] has exited with exit status 255," +
    " please make sure the URL is valid, and Docker 18.09 or later is installed on the remote host:" +
    " stderr=ssh: connect to host 192.168.1.20 port 22: Operation timed out",
};

describe("readWaitOutcome: transport or container end", () => {
  it("code 0 + stdout: it is the CONTAINER's code, even when it is 255", () => {
    assert.deepEqual(readWaitOutcome({ code: 0, stdout: "0\n", stderr: "" }), {
      kind: "exit",
      exitCode: 0,
    });
    assert.deepEqual(readWaitOutcome({ code: 0, stdout: "137\n", stderr: "" }), {
      kind: "exit",
      exitCode: 137,
    });
    // The trap, named: 255 on stdout is a container that exited 255. Classifying it as transport
    // would wait half an hour for an already dead container, every time.
    assert.deepEqual(readWaitOutcome({ code: 0, stdout: "255\n", stderr: "" }), {
      kind: "exit",
      exitCode: 255,
    });
  });

  it("code 0 without a readable number: an end, for lack of better, never a reattach", () => {
    assert.deepEqual(readWaitOutcome({ code: 0, stdout: "", stderr: "" }), {
      kind: "exit",
      exitCode: 1,
    });
  });

  it("ssh's 255, copied by the CLI into its message, is TRANSPORT", () => {
    const outcome = readWaitOutcome(SSH_DOWN);
    assert.equal(outcome.kind, "transport");
  });

  it("the helper's code is read as a NUMBER: 1 is not 255", () => {
    // Same sentence, another number, and the verdict changes. That is all this case proves, and it
    // is the difference with an `includes()` on the message.
    //
    // The real CLI would prefix this message with "error during connect:", which alone would mean
    // transport; the fixture omits it precisely to isolate reading the number.
    const outcome = readWaitOutcome({
      code: 1,
      stdout: "",
      stderr:
        "command [ssh -l operator -- 192.168.1.20 docker system dial-stdio] has exited with exit status 1",
    });
    assert.deepEqual(outcome, { kind: "exit", exitCode: 1 });
  });

  it('a daemon answering "No such container" is an END, not a broken pipe', () => {
    const outcome = readWaitOutcome({
      code: 1,
      stdout: "",
      stderr: "Error response from daemon: No such container: legion-session-abc",
    });
    assert.deepEqual(outcome, { kind: "exit", exitCode: 1 });
  });

  it('a "255" inside an identifier does not make a transport', () => {
    // Why the criterion reads a CAPTURED number and not an `includes`: container fingerprints
    // contain digits, and this one contains 255.
    const outcome = readWaitOutcome({
      code: 1,
      stdout: "",
      stderr: "Error response from daemon: No such container: a255f0ba9c11",
    });
    assert.deepEqual(outcome, { kind: "exit", exitCode: 1 });
  });

  it("a CLI that reached no daemon is transport, whatever the transport", () => {
    const outcome = readWaitOutcome({
      code: 1,
      stdout: "",
      stderr:
        'error during connect: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/x/wait":' +
        " dial unix /var/run/docker.sock: connect: connection refused",
    });
    assert.equal(outcome.kind, "transport");
  });
});

describe("waitWithReattach: probe again, then reattach", () => {
  it("the normal path probes nothing and does not sleep", async () => {
    let probes = 0;
    const exitCode = await waitWithReattach(
      async () => ({ code: 0, stdout: "0", stderr: "" }),
      async () => {
        probes += 1;
        return true;
      },
      { container: CONTAINER, sleep: noNap },
    );
    assert.equal(exitCode, 0);
    assert.equal(probes, 0);
  });

  it("a broken pipe reattaches to the SAME container and returns the container's code", async () => {
    const tried: string[] = [];
    let probes = 0;
    const exitCode = await waitWithReattach(
      async () => {
        tried.push(CONTAINER);
        return tried.length === 1 ? SSH_DOWN : { code: 0, stdout: "0", stderr: "" };
      },
      async () => {
        probes += 1;
        return true;
      },
      { container: CONTAINER, sleep: noNap },
    );
    assert.equal(exitCode, 0);
    assert.equal(tried.length, 2, "the second call is a reattach, not a conclusion");
    assert.equal(probes, 1, "probe again BEFORE reattaching");
  });

  it("a host that never comes back fails naming the host, not the session", async () => {
    let probes = 0;
    await assert.rejects(
      () =>
        waitWithReattach(
          async () => SSH_DOWN,
          async () => {
            probes += 1;
            return false;
          },
          { container: CONTAINER, sleep: noNap },
        ),
      (err: Error) => {
        // "host unreachable" and not "the agent process exited with code 1": runLifecycle records this
        // message as the failure reason, so it is what the operator reads. The old one sent them to a
        // trace with nothing in it.
        assert.match(err.message, /^host unreachable/);
        assert.doesNotMatch(err.message, /agent process/);
        return true;
      },
    );
    // The bound is the constants', and it is reached: one probe window, because a host that never
    // answers never led to a second reattach.
    assert.equal(probes, HOST_PROBE_ATTEMPTS);
  });

  it("a pipe breaking at EVERY reattach stops at the bound", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        waitWithReattach(
          async () => {
            attempts += 1;
            return SSH_DOWN;
          },
          async () => true, // the machine answers, but the pipe breaks again at once
          { container: CONTAINER, sleep: noNap },
        ),
      (err: Error) => {
        assert.match(err.message, /^host unreachable/);
        return true;
      },
    );
    // A session reattaching forever holds a runner slot nobody gets back: the first try plus
    // REATTACH_MAX reattaches, then conclude.
    assert.equal(attempts, REATTACH_MAX + 1);
  });
});
