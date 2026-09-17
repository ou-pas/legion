// Keeps a Mac awake while it works (01/09, multi-machine work, slice 05). Three things to keep:
//
// 1. One `caffeinate` per host. Two sessions on the same Mac must not open two ssh connections,
//    and the first to finish must not let the machine sleep under the second. It is a counter,
//    and counters get it wrong.
// 2. It drops with the last session. An assertion that outlives the session keeps a Mac awake
//    forever.
// 3. Its absence fails no session. A Linux host, a missing `caffeinate`, a refusing ssh: we say
//    so once per host and the session starts anyway.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { beforeEach, describe, it } from "node:test";
import type { ChildProcess } from "node:child_process";
import {
  caffeinateArgs,
  holdHostAwake,
  resetHoldsForTests,
  setHoldSpawnForTests,
} from "./caffeinate.js";

const MAC = "ssh://operator@192.168.1.20";
const OTHER_MAC = "ssh://operator@192.168.1.21";

type Fake = { args: string[]; killed: boolean; child: ChildProcess & EventEmitter };

let spawned: Fake[] = [];
/** A fake `ssh`: does nothing, remembers its arguments and its death. */
function fakeSpawn(_cmd: string, args: string[]): ChildProcess {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  const fake: Fake = { args, killed: false, child };
  child.stderr = null;
  child.kill = ((): boolean => {
    fake.killed = true;
    return true;
  }) as ChildProcess["kill"];
  spawned.push(fake);
  return child;
}

beforeEach(() => {
  spawned = [];
  resetHoldsForTests();
  setHoldSpawnForTests(fakeSpawn);
});

describe("caffeinateArgs: the command, and when there is none", () => {
  it("an ssh:// with user and port gives an ssh target and the leash at the end of a pipe", () => {
    const args = caffeinateArgs("ssh://operator@192.168.1.20:2222");
    assert.ok(args);
    assert.ok(args.includes("operator@192.168.1.20"), args.join(" "));
    assert.deepEqual(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2), ["-p", "2222"]);
    // `caffeinate -i cat`, not `caffeinate -i`: the pipe is the leash. Our ssh dies, `cat` gets
    // EOF, `caffeinate` exits with it. Without a command the assertion would survive.
    assert.equal(args.at(-1), "caffeinate -i cat");
    // Never prompt a machine nobody sits in front of.
    assert.ok(args.includes("BatchMode=yes"), args.join(" "));
  });

  it("an ssh:// without a user names the machine alone", () => {
    const args = caffeinateArgs("ssh://192.168.1.20");
    assert.ok(args);
    assert.ok(args.includes("192.168.1.20"));
    assert.ok(!args.includes("-p"), "no port to pass when the URL carries none");
  });

  it("a host that is not a remote shell is not kept awake", () => {
    assert.equal(caffeinateArgs("tcp://192.168.1.20:2375"), null);
    assert.equal(caffeinateArgs("unix:///var/run/docker.sock"), null);
    assert.equal(caffeinateArgs("not a url"), null);
  });
});

describe("holdHostAwake: one per host, drops with the last session", () => {
  it("a local socket starts nothing, and releases without breaking anything", () => {
    holdHostAwake(null)();
    holdHostAwake("unix:///var/run/docker.sock")();
    assert.equal(spawned.length, 0);
  });

  it("two sessions on the same Mac hold a single caffeinate", () => {
    const first = holdHostAwake(MAC);
    const second = holdHostAwake(MAC);
    assert.equal(spawned.length, 1);
    first();
    assert.equal(spawned[0]!.killed, false, "the second session is still working");
    second();
    assert.equal(spawned[0]!.killed, true, "the last session drops it");
  });

  it("two different Macs are held separately", () => {
    const a = holdHostAwake(MAC);
    holdHostAwake(OTHER_MAC);
    assert.equal(spawned.length, 2);
    a();
    assert.equal(spawned[0]!.killed, true);
    assert.equal(spawned[1]!.killed, false);
  });

  it("releasing the SAME hold twice counts down once", () => {
    // The wait loop's `finally` can run twice on an error path. Without this guard the second
    // hold would see its count reach zero and the Mac would fall asleep under it.
    const first = holdHostAwake(MAC);
    const second = holdHostAwake(MAC);
    first();
    first();
    assert.equal(spawned[0]!.killed, false);
    second();
    assert.equal(spawned[0]!.killed, true);
  });

  it("a session following a finished one starts a new caffeinate", () => {
    holdHostAwake(MAC)();
    holdHostAwake(MAC)();
    assert.equal(spawned.length, 2, "each count restarted from zero opens its own connection");
  });
});

describe("holdHostAwake: absence is reported and fails nobody", () => {
  it("a refusing ssh does not throw, and the hold still releases", () => {
    setHoldSpawnForTests(() => {
      throw new Error("spawn ssh ENOENT");
    });
    const release = holdHostAwake(MAC);
    assert.doesNotThrow(release);
  });

  it("a caffeinate missing on the host does not throw and kills nothing", () => {
    const release = holdHostAwake(MAC);
    // 127: the remote shell did not find the command (Linux, BSD, stripped-down Mac).
    spawned[0]!.child.emit("exit", 127, null);
    assert.doesNotThrow(release);
  });

  it("an ssh dying along the way does not fail the session it accompanied", () => {
    const release = holdHostAwake(MAC);
    spawned[0]!.child.emit("error", new Error("connection lost"));
    assert.doesNotThrow(release);
  });
});
