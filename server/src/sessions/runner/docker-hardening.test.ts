// A session's two containers are stripped of their powers (05/09).
//
// They only had `--memory` and `--cpus`. A default Docker container keeps some fifteen kernel
// capabilities neither a session nor a proxy uses, and its PID limit is the host's: a fork bomb in
// a session filled the MACHINE's PID table. We already paid for that from the other end (nine
// thousand orphaned `ssh`, 02/09, see `docker-exec.ts`).
//
// This file pins the three flags on BOTH `run`s. The proxy is the easiest to forget: it parses
// traffic it has no reason to trust, and it only exists in a `limited` environment, so it does not
// show up in tests of the common path.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-hardening-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { DockerRunner } = await import("./docker.js");
type Spec = import("./types.js").SessionSpec;

function recorder() {
  const calls: string[][] = [];
  const exec = (args: string[]) => {
    calls.push(args);
    return Promise.resolve({ code: 0, stdout: "cafe1234", stderr: "" });
  };
  return { exec, calls };
}

/** `provision` reads only about ten of a spec's forty fields (see remote-mounts.test.ts). */
const spec = (over: Partial<Spec> = {}): Spec =>
  ({
    sessionId: "s1",
    callbackUrl: "http://127.0.0.1:8787",
    claudeStateDir: join(dir, "claude"),
    workspaceDir: join(dir, "workspace"),
    packageCacheDir: null,
    image: null,
    sshKeyPath: null,
    sshKnownHostsPath: null,
    browser: null,
    network: { mode: "open" },
    env: {},
    ...over,
  }) as unknown as Spec;

const runs = (calls: string[][]) => calls.filter((a) => a[0] === "run" && a.includes("-d"));
const containerOf = (args: string[]) => args[args.indexOf("--name") + 1];

/** `--security-opt` as TWO arguments: that is how the CLI reads them, and a test accepting
 *  "--security-opt=…" would let through a form docker refuses. */
function assertHardened(args: string[], what: string): void {
  assert.ok(args.includes("--cap-drop=ALL"), `${what}: no kernel capability may remain`);
  const i = args.indexOf("--security-opt");
  assert.deepEqual(
    args.slice(i, i + 2),
    ["--security-opt", "no-new-privileges"],
    `${what}: no-new-privileges`,
  );
  assert.ok(args.includes("--pids-limit=2048"), `${what}: the host PID table is not a ceiling`);
}

describe("a session's containers start without capabilities, without escalation and under a PID ceiling", () => {
  it("the session container", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(spec());

    const [session] = runs(calls);
    assert.equal(containerOf(session ?? []), "legion-session-s1");
    assertHardened(session ?? [], "session");
  });

  it("the egress proxy, which parses traffic it has no reason to trust", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(
      spec({ network: { mode: "limited", allowedHosts: ["example.com"] } }),
    );

    const proxy = runs(calls).find((a) => containerOf(a) === "legion-proxy-s1");
    assert.ok(proxy, "the sidecar must start in a limited environment");
    assertHardened(proxy, "proxy");
  });

  it("NO capability is added back: both images were tried, they need none", async () => {
    // A `--cap-add` slipping in without a written reason would cancel the `--cap-drop` above, and
    // nothing in `docker inspect` would say it louder than the rest.
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(
      spec({ network: { mode: "limited", allowedHosts: [] } }),
    );

    for (const args of runs(calls))
      assert.deepEqual(
        args.filter((a) => a.startsWith("--cap-add")),
        [],
        `${containerOf(args)}: capability added back`,
      );
  });

  it("the runner's resource ceilings are still there: hardening adds, it does not replace", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, { memoryMb: 2048, cpus: 2 }, exec, "bare").provision(spec());

    const [session] = runs(calls);
    assert.ok(session?.includes("--memory=2048m"));
    assert.ok(session?.includes("--cpus=2"));
  });
});
