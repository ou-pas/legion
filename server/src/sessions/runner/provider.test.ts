// `LEGION_RUNNER=process` does not only change the runtime, it also turns off the daemon probe.
// Without both, a developer in process mode would be refused a launch because of a Docker that is
// not running and that they do not need.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

const before = process.env.LEGION_RUNNER;
after(() => {
  if (before === undefined) delete process.env.LEGION_RUNNER;
  else process.env.LEGION_RUNNER = before;
});

const { dockerRunnerProvider } = await import("./provider.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

describe("the production provider", () => {
  it("follows the kind declared by the runner row", () => {
    delete process.env.LEGION_RUNNER;
    assert.equal(dockerRunnerProvider.make(RUNNER_KIND.process, null).kind, RUNNER_KIND.process);
    assert.equal(dockerRunnerProvider.make(RUNNER_KIND.docker, null).kind, RUNNER_KIND.docker);
  });

  it("probes only for a docker runner", () => {
    delete process.env.LEGION_RUNNER;
    assert.equal(dockerRunnerProvider.daemonProbe(RUNNER_KIND.process), null);
    assert.ok(dockerRunnerProvider.daemonProbe(RUNNER_KIND.docker));
  });

  it("same guard for the image probe: docker only", () => {
    delete process.env.LEGION_RUNNER;
    assert.equal(dockerRunnerProvider.imageProbe(RUNNER_KIND.process), null);
    assert.ok(dockerRunnerProvider.imageProbe(RUNNER_KIND.docker));
  });

  it("`LEGION_RUNNER=process` forces the runtime AND turns off the probe", () => {
    process.env.LEGION_RUNNER = "process";
    assert.equal(dockerRunnerProvider.make(RUNNER_KIND.docker, null).kind, RUNNER_KIND.process);
    assert.equal(dockerRunnerProvider.daemonProbe(RUNNER_KIND.docker), null);
    assert.equal(dockerRunnerProvider.imageProbe(RUNNER_KIND.docker), null);
  });
});
