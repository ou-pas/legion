// When nobody wired the port, it must throw and name the wiring site. Silently falling back to
// Docker would spawn a container nobody asked for, and a quiet test would pass while spawning.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { registerRunnerProvider, runnerProvider } = await import("./ports.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

describe("the RunnerProvider port", () => {
  it("throws naming index.ts while nothing is wired", () => {
    assert.throws(() => runnerProvider(), /index\.ts must call registerRunnerProvider/);
  });

  it("returns the wired implementation, and the last one wired wins", () => {
    const first = {
      make: () => {
        throw new Error("never");
      },
      daemonProbe: () => null,
      imageProbe: () => null,
    };
    registerRunnerProvider(first);
    assert.equal(runnerProvider(), first);

    const second = {
      make: () => ({ kind: RUNNER_KIND.process }) as never,
      daemonProbe: () => null,
      imageProbe: () => null,
    };
    registerRunnerProvider(second);
    assert.equal(runnerProvider(), second);
    assert.equal(runnerProvider().make(RUNNER_KIND.docker, null).kind, RUNNER_KIND.process);
  });
});
