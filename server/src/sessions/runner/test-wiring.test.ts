// The trap this helper exists to avoid: a fake runtime turns the real probe OFF. It lived inline
// in `manager.ts` (`daemonProbeFor`) and nothing held it. Losing it breaks nothing at once; it
// just makes twenty tests that never touch Docker probe Docker, and the day the daemon is down
// they all fall together.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { runnerProvider } = await import("./ports.js");
const { wireFakeDaemonProbe, wireFakeImageProbe, wireFakeRunner, wireRealRunner } =
  await import("./test-wiring.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const fake = { kind: RUNNER_KIND.process } as never;

describe("runner port wiring for tests", () => {
  it("`wireRealRunner` wires production", () => {
    wireRealRunner();
    assert.equal(runnerProvider().make(RUNNER_KIND.process, null).kind, RUNNER_KIND.process);
    assert.ok(runnerProvider().daemonProbe(RUNNER_KIND.docker), "the real probe stays in place");
    assert.ok(
      runnerProvider().imageProbe(RUNNER_KIND.docker),
      "the real image probe stays in place",
    );
  });

  it("a fake runtime replaces the runtime AND turns off both probes", () => {
    wireFakeRunner(() => fake);
    assert.equal(runnerProvider().make(RUNNER_KIND.docker, null), fake);
    assert.equal(runnerProvider().daemonProbe(RUNNER_KIND.docker), null);
    assert.equal(runnerProvider().imageProbe(RUNNER_KIND.docker), null);
  });

  it("an injected probe wins over the fake runtime", async () => {
    const probe = async () => ({ ok: false as const, why: "silent daemon" });
    wireFakeDaemonProbe(probe);
    assert.equal(runnerProvider().daemonProbe(RUNNER_KIND.docker), probe);
    // Never for a runner without a daemon, whatever was injected.
    assert.equal(runnerProvider().daemonProbe(RUNNER_KIND.process), null);
  });

  it("an injected image probe wins over the fake runtime, same rule", async () => {
    const probe = async () => ({ ok: false as const, why: "image missing" });
    wireFakeImageProbe(probe);
    assert.equal(runnerProvider().imageProbe(RUNNER_KIND.docker), probe);
    assert.equal(runnerProvider().imageProbe(RUNNER_KIND.process), null);
  });

  it("`wireFakeRunner(null)` hands back without clearing injected probes", () => {
    wireFakeRunner(null);
    assert.equal(runnerProvider().make(RUNNER_KIND.process, null).kind, RUNNER_KIND.process);
    wireRealRunner();
    assert.ok(
      runnerProvider().daemonProbe(RUNNER_KIND.docker),
      "`wireRealRunner` resets everything",
    );
    assert.ok(
      runnerProvider().imageProbe(RUNNER_KIND.docker),
      "`wireRealRunner` resets the image side too",
    );
  });
});
