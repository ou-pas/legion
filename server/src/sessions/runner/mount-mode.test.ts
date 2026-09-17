// Two installs (git clone, image) times two daemons (this machine's, an `ssh://` one). Only one
// cell moved compared to what `docker.ts` did before (05/09): local daemon + container install.
// The other three are written here so an over-eager fix does not take them along; the common
// development case is the most exposed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionFilesAreVolumes } from "./mount-mode.js";

describe("how a session's files are mounted", () => {
  it("git clone + this machine's daemon: PATHS, as today", () => {
    // The developer machine: `tsx watch` in the clone, local socket, same paths on both sides.
    assert.equal(sessionFilesAreVolumes(null, "bare"), false);
  });

  it("container install + this machine's daemon: VOLUMES", () => {
    // The cell that changed. The control plane's paths (`/app/data/…`) do not exist on the host:
    // a bind mount would silently create an empty folder there.
    assert.equal(sessionFilesAreVolumes(null, "docker"), true);
  });

  it("a remote daemon takes volumes, whatever the install", () => {
    assert.equal(sessionFilesAreVolumes("ssh://mini-atelier", "bare"), true);
    assert.equal(sessionFilesAreVolumes("ssh://mini-atelier", "docker"), true);
  });

  it("the caller does not guess the mode: it has a default, read from disk", () => {
    // The full signature exists for the test; callers only pass the docker host.
    assert.equal(typeof sessionFilesAreVolumes(null), "boolean");
  });
});
