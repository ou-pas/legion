// Session volume naming, both ways (lot 11).
//
// `volumeNames` writes a name, `parseVolume` reads it back, and the Infra page counts orphans with
// the latter. Nothing forced them to agree: a prefix changed on one side made volumes invisible to
// the sweep, hence eternal on a remote machine's disk (640 MB per session).
//
// The docker gestures of `volumes.ts` are exercised elsewhere against a fake executor
// (remote-mounts.test.ts, workspace.test.ts); this file only holds the round trip.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PACKAGE_CACHE_VOLUME, parseVolume, volumeNames } from "./volumes.js";

describe("volumeNames and parseVolume agree", () => {
  const id = "Wv8klSI15U1B";

  it("a session's three volumes carry the `legion-` prefix", () => {
    // The same filter as containers and networks: it is what puts them in the Infra page's orphan
    // count.
    for (const name of Object.values(volumeNames(id)))
      assert.match(name, /^legion-/, `${name} must be found by the Infra filter`);
  });

  it("each written name reads back to its role AND its session", () => {
    const n = volumeNames(id);
    assert.deepEqual(parseVolume(n.workspace), { role: "workspace", sessionId: id });
    assert.deepEqual(parseVolume(n.claudeState), { role: "claude-state", sessionId: id });
    assert.deepEqual(parseVolume(n.secrets), { role: "secrets", sessionId: id });
  });

  it("the three names are distinct, otherwise two roles would share a volume", () => {
    assert.equal(new Set(Object.values(volumeNames(id))).size, 3);
  });
});

describe("what belongs to no session", () => {
  it("the shared package cache escapes orphan marking", () => {
    // `sessionId: null` is what keeps it out, just as the browser service escapes it on the container
    // side. Counting it as orphaned would sweep it every round.
    assert.equal(parseVolume(PACKAGE_CACHE_VOLUME).sessionId, null);
  });

  it('a volume foreign to the product reads as "autre" (the stored role value), without session', () => {
    assert.deepEqual(parseVolume("postgres_data"), { role: "autre", sessionId: null });
  });
});
