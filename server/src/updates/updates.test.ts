// The update: what compares, and what refuses (26/08).
//
// Both halves are pure: one decides whether the update button shows, the other whether it acts.
// The refusal matters more: getting it wrong one way loses work, the other way only means waiting.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions, latestVersion, newerThan, parseVersion } from "./semver.js";
import { blockerReason, updateBlocker, type UpdateState } from "./guards.js";
import { describeTag, githubSlug } from "./git.js";

describe("parsing a version tag", () => {
  it("with or without the v", () => {
    assert.deepEqual(parseVersion("v1.2.3"), {
      major: 1,
      minor: 2,
      patch: 3,
      pre: "",
      tag: "v1.2.3",
    });
    assert.deepEqual(parseVersion("1.2.3"), {
      major: 1,
      minor: 2,
      patch: 3,
      pre: "",
      tag: "1.2.3",
    });
  });

  it("a pre-release", () => {
    assert.equal(parseVersion("v1.2.0-beta.1")?.pre, "beta.1");
  });

  it("what is not a version is IGNORED, not guessed", () => {
    // A repo also carries non-version tags; guessing would offer an "update" to any landmark.
    for (const t of ["", "latest", "release", "v1.2", "v1.2.3.4", "sprint-4", "v1.2.3-"])
      assert.equal(parseVersion(t), null);
  });
});

describe("which one is newest", () => {
  const v = (t: string) => parseVersion(t)!;

  it("natural order on the three numbers", () => {
    assert.ok(compareVersions(v("v1.0.0"), v("v2.0.0")) < 0);
    assert.ok(compareVersions(v("v1.2.0"), v("v1.10.0")) < 0); // not alphabetical
    assert.ok(compareVersions(v("v1.0.9"), v("v1.0.10")) < 0);
    assert.equal(compareVersions(v("v1.0.0"), v("1.0.0")), 0);
  });

  it("a pre-release ALWAYS precedes the final of the same number", () => {
    assert.ok(compareVersions(v("v1.2.0-beta.1"), v("v1.2.0")) < 0);
    assert.ok(compareVersions(v("v1.2.0-beta.1"), v("v1.2.0-beta.2")) < 0);
  });

  it("the newest of a list, ignoring noise", () => {
    assert.equal(
      latestVersion(["v0.9.0", "latest", "v1.10.0", "v1.9.0", "sprint-4"])?.tag,
      "v1.10.0",
    );
    assert.equal(latestVersion(["latest", "sprint-4"]), null);
    assert.equal(latestVersion([]), null);
  });
});

describe("is there something newer than what runs", () => {
  it("yes", () => {
    assert.equal(newerThan("v0.4.0", ["v0.4.0", "v0.5.0"])?.tag, "v0.5.0");
  });

  it("no: already on it", () => {
    assert.equal(newerThan("v0.5.0", ["v0.4.0", "v0.5.0"]), null);
  });

  it("no: we are AHEAD (a local tag newer than the forge)", () => {
    assert.equal(newerThan("v0.6.0", ["v0.5.0"]), null);
  });

  it("no local tag, but the forge has one: an update is possible", () => {
    assert.equal(newerThan(null, ["v0.1.0"])?.tag, "v0.1.0");
  });

  it("no tag anywhere: nothing to offer", () => {
    // The repo's real state before `make release`: the button must NOT appear.
    assert.equal(newerThan(null, []), null);
    assert.equal(newerThan(null, ["latest"]), null);
  });
});

const OK: UpdateState = {
  activeSessions: 0,
  dirty: false,
  branch: "main",
  target: "v0.5.0",
  reachable: true,
};

describe("what prevents an update", () => {
  it("nothing, when all is in order", () => {
    assert.equal(updateBlocker(OK), null);
  });

  it("running sessions: the refusal protecting the turn in flight", () => {
    // 08/09: the message promised containers "carried away", measured false. What sessions really
    // lose is their control plane: `callInternal` and `updateTask` have no replay.
    const s = { ...OK, activeSessions: 2 };
    assert.equal(updateBlocker(s), "sessions");
    assert.match(blockerReason("sessions", s) ?? "", /2 session/);
    assert.doesNotMatch(
      blockerReason("sessions", s) ?? "",
      /carried away/,
      "no longer promise destroyed containers: false for any remote runner",
    );
    assert.match(blockerReason("sessions", s) ?? "", /turn in flight/);
  });

  it("a dirty tree: you develop in this repo, it is the norm", () => {
    assert.equal(updateBlocker({ ...OK, dirty: true }), "dirty");
  });

  it("a working branch: not left with a click", () => {
    const s = { ...OK, branch: "feat/channels" };
    assert.equal(updateBlocker(s), "detached");
    assert.match(blockerReason("detached", s) ?? "", /feat\/channels/);
  });

  it("detached HEAD", () => {
    const s = { ...OK, branch: null };
    assert.equal(updateBlocker(s), "detached");
    assert.match(blockerReason("detached", s) ?? "", /come back/);
  });

  it("master counts as main", () => {
    assert.equal(updateBlocker({ ...OK, branch: "master" }), null);
  });

  it("forge unreachable: we do NOT know, and say so", () => {
    // Distinct from "up to date": silence here would read as confirmation.
    assert.equal(updateBlocker({ ...OK, reachable: false, target: null }), "unknown");
  });

  it("already up to date is not a refusal, it is the normal state", () => {
    assert.equal(updateBlocker({ ...OK, target: null }), "up-to-date");
    assert.equal(blockerReason("up-to-date", { ...OK, target: null }), null);
  });

  it("THE ORDER IS THE MESSAGE: what costs work is said first", () => {
    // Dirty tree AND live sessions: the session is named, it loses something unrecoverable.
    assert.equal(
      updateBlocker({ ...OK, activeSessions: 1, dirty: true, branch: "feat/x" }),
      "sessions",
    );
  });
});

describe("recognising the GitHub repo from the origin", () => {
  it("the usual forms", () => {
    assert.equal(githubSlug("https://github.com/ou-pas/legion.git"), "ou-pas/legion");
    assert.equal(githubSlug("https://github.com/ou-pas/legion"), "ou-pas/legion");
    assert.equal(githubSlug("git@github.com:ou-pas/legion.git"), "ou-pas/legion");
  });

  it("AN SSH ALIAS, which is what this repo really uses", () => {
    // `git@github-legion:...` is a ~/.ssh/config entry; requiring `github.com` would return `null`
    // on the one machine that matters.
    assert.equal(githubSlug("git@github-legion:ou-pas/legion.git"), "ou-pas/legion");
  });

  it("an origin that is not GitHub", () => {
    assert.equal(githubSlug("git@gitlab.com:acme/back.git"), null);
    assert.equal(githubSlug(""), null);
  });
});

// Lot 89's bug: the card offered "→ v0.1.0" on a HEAD one commit AFTER v0.1.0, an update going
// backwards, because it compared with the tag EXACTLY on HEAD instead of the last reachable one.
describe("reading git describe output", () => {
  it("the tag and the distance", () => {
    assert.deepEqual(describeTag("v0.1.0-1-gae5ab51"), { tag: "v0.1.0", ahead: 1 });
    assert.deepEqual(describeTag("v0.1.0-1-gae5ab51\n"), { tag: "v0.1.0", ahead: 1 });
  });

  it("HEAD carries the tag: zero distance", () => {
    assert.deepEqual(describeTag("v0.4.0-0-g5f49805"), { tag: "v0.4.0", ahead: 0 });
  });

  it("a tag containing dashes stays whole", () => {
    // Anchored on the LAST `-<n>-g<sha>`: cutting at the first dash would give another version.
    assert.deepEqual(describeTag("v1.2.0-beta.1-3-gabc1234"), { tag: "v1.2.0-beta.1", ahead: 3 });
  });

  it("what is not describe --long output returns null", () => {
    for (const s of ["", "v0.1.0", "v0.1.0-1", "fatal: no names found"])
      assert.equal(describeTag(s), null);
  });
});

describe("the comparison point is the last REACHABLE tag", () => {
  it("a HEAD ahead does NOT offer to go back to the tag it passed", () => {
    // The exact 26/08 case: HEAD = ae5ab51, one commit after v0.1.0, the forge's only tag.
    const local = { tag: null as string | null, lastTag: "v0.1.0" };
    assert.equal(newerThan(local.tag ?? local.lastTag, ["v0.1.0"]), null);
  });

  it("but a REALLY newer tag is still offered", () => {
    const local = { tag: null as string | null, lastTag: "v0.1.0" };
    assert.equal(newerThan(local.tag ?? local.lastTag, ["v0.1.0", "v0.2.0"])?.tag, "v0.2.0");
  });

  it("no reachable tag: the forge's newest is indeed an update", () => {
    // A clone that never tagged or fetched: "the last known" is right here, the only case where
    // the old behaviour was.
    assert.equal(newerThan(null, ["v0.1.0"])?.tag, "v0.1.0");
  });
});
