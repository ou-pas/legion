// The 03/09 scenarios (shared browsers escaping cleanup): pure logic, no docker or database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browserContainerRunnerId,
  browserNetworkRunnerId,
  isOrphanBrowserContainer,
  isOrphanBrowserNetwork,
} from "./browser-cleanup.js";

describe("browserContainerRunnerId / browserNetworkRunnerId: extracting the named runner", () => {
  it("container: the suffix after legion-browser-", () => {
    assert.equal(browserContainerRunnerId("legion-browser-iRvQoryWgMYq"), "iRvQoryWgMYq");
  });
  it("network: the suffix after legion-browser-net-", () => {
    assert.equal(browserNetworkRunnerId("legion-browser-net-ox8OwMtd80tX"), "ox8OwMtd80tX");
  });
  it("a name without the prefix returns null", () => {
    assert.equal(browserContainerRunnerId("legion-session-abc"), null);
    assert.equal(browserNetworkRunnerId("legion-net-abc"), null);
  });
});

describe("isOrphanBrowserContainer: the criterion is the RUNNER, never the session", () => {
  const registry = new Map([
    ["portable-atelier", true],
    ["local", false],
  ]);

  it("enabled runner: never orphan, even with no session running", () => {
    assert.equal(isOrphanBrowserContainer("portable-atelier", registry), false);
  });
  it("runner unknown to the table (deleted or never declared): orphan", () => {
    assert.equal(isOrphanBrowserContainer("never-seen", registry), true);
  });
  it("known but disabled runner: orphan, no session can be routed there", () => {
    assert.equal(isOrphanBrowserContainer("local", registry), true);
  });
  it("name outside the prefix (null): never orphan by this criterion", () => {
    assert.equal(isOrphanBrowserContainer(null, registry), false);
  });
});

describe("isOrphanBrowserNetwork: same criterion, plus the missing container", () => {
  const registry = new Map([
    ["mini-atelier", true],
    ["local", false],
  ]);

  it("network WITHOUT its container: waste even if the runner is enabled", () => {
    assert.equal(isOrphanBrowserNetwork("mini-atelier", false, registry), true);
  });
  it("network WITH its container, enabled runner: not orphan", () => {
    assert.equal(isOrphanBrowserNetwork("mini-atelier", true, registry), false);
  });
  it("network with container but disabled runner: orphan anyway", () => {
    assert.equal(isOrphanBrowserNetwork("local", true, registry), true);
  });
  it("unknown runner: orphan, container or not", () => {
    assert.equal(isOrphanBrowserNetwork("never-seen", true, registry), true);
  });
});
