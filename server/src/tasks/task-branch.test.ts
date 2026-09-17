// Formatting a branch, edge case by edge case.
//
// A malformed branch does not fail here: it fails in the container, at `git push`, after the agent
// worked for an hour. A forgotten edge case costs lost work, not a red test, hence the explicit
// sweep of the empty name, the name without a single letter, accents, doubled dashes and the very
// long name. Accented inputs below are deliberate.
//
// No database, no mock: the module is pure, and so are its tests.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRANCH_TYPE } from "./task-branch.js";
import {
  BRANCH_TYPES,
  asBranchType,
  branchKey,
  branchSlug,
  formatBranch,
  isConventionalBranch,
} from "./task-branch.js";

const SCOPE = "JUoRZqThA5";

describe("branchSlug", () => {
  it("lowercases and replaces anything not a-z0-9 with a dash", () => {
    assert.equal(branchSlug("Add the Button"), "add-the-button");
    assert.equal(branchSlug("fix: 404 on /api/tasks"), "fix-404-on-api-tasks");
  });

  it("strips accents rather than dropping them with their letter", () => {
    // Without this normalisation "déployé" would give "d-ploy-": the word becomes unreadable.
    assert.equal(branchSlug("Déployer la préréservation"), "deployer-la-prereservation");
    assert.equal(branchSlug("Ça marche où ?"), "ca-marche-ou");
  });

  it("never doubles a dash and leaves none at the edges", () => {
    assert.equal(branchSlug("  --  a  ---  b  --  "), "a-b");
    assert.equal(branchSlug("!!! urgent !!!"), "urgent");
  });

  it("returns the empty string when the name has no usable character", () => {
    assert.equal(branchSlug(""), "");
    assert.equal(branchSlug("   "), "");
    assert.equal(branchSlug("⚠️ ??? ***"), "");
  });

  it("bounds the length without leaving a dash at the cut", () => {
    // The trap: slicing at character 48 lands on a separator half the time, and a branch ending with
    // a dash is refused by the spec.
    const long = "a".repeat(47) + " " + "b".repeat(40);
    const slug = branchSlug(long);
    assert.ok(slug.length <= 48, `slug too long: ${slug.length}`);
    assert.doesNotMatch(slug, /-$/, "a trailing dash survived the cut");
    assert.equal(branchSlug("word ".repeat(60)).endsWith("-"), false);
  });
});

describe("branchKey", () => {
  it("is deterministic, lowercase and alphanumeric", () => {
    assert.equal(branchKey(SCOPE), branchKey(SCOPE));
    assert.match(branchKey(SCOPE), /^[a-z0-9]+$/);
  });

  it("separates two scopes differing only by case", () => {
    // The digest's real motive: `toLowerCase()` on a nanoid would make these two tasks push to the
    // same branch, the second silently overwriting the first.
    assert.notEqual(branchKey("aB3xYz9qLm"), branchKey("Ab3XyZ9QlM"));
  });
});

describe("formatBranch", () => {
  it("composes `<type>/<slug>-<key>`", () => {
    const branch = formatBranch(BRANCH_TYPE.feature, "Add the button", SCOPE);
    assert.equal(branch, `feature/add-the-button-${branchKey(SCOPE)}`);
  });

  it("falls back to the key alone when the name gives nothing, never to an invalid branch", () => {
    for (const name of ["", "   ", "⚠️", "-- --"]) {
      const branch = formatBranch(BRANCH_TYPE.chore, name, SCOPE);
      assert.equal(branch, `chore/${branchKey(SCOPE)}`);
      assert.ok(isConventionalBranch(branch), `"${branch}" is not conforming`);
    }
  });

  it("returns a conforming branch whatever name it is given", () => {
    const noms = [
      "",
      "   ",
      "⚠️ ??? ***",
      "Déjà-vu — l'été",
      "a".repeat(300),
      "-- start and end --",
      "MAJUSCULES ET Ç",
      "emoji 🎉 in the middle",
      "//../../etc/passwd",
      "\n\ttabs\n",
      "123",
      "1/2 then 2/2",
    ];
    for (const type of BRANCH_TYPES)
      for (const nom of noms) {
        const branch = formatBranch(type, nom, SCOPE);
        assert.ok(isConventionalBranch(branch), `"${nom}" → "${branch}" is not conforming`);
      }
  });

  it("depends only on type, name and scope: two identical calls give the same name", () => {
    assert.equal(
      formatBranch(BRANCH_TYPE.bugfix, "The same", SCOPE),
      formatBranch(BRANCH_TYPE.bugfix, "The same", SCOPE),
    );
  });
});

describe("isConventionalBranch", () => {
  it("accepts what the spec accepts", () => {
    assert.ok(isConventionalBranch("feature/add-the-button-1a2b3c4d"));
    assert.ok(isConventionalBranch("bugfix/404"));
    assert.ok(isConventionalBranch("chore/a"));
  });

  it("refuses what the spec refuses, our old branches included", () => {
    for (const bad of [
      "legion/JUoRZqThA5", // the old form: no allowed type, no lowercase, no description
      "feature/Capital",
      "feature/with_underscore",
      "feature/double--dash",
      "feature/-edge",
      "feature/edge-",
      "feature/",
      BRANCH_TYPE.feature,
      "/add",
      "hotfix/not-a-type-of-this-repo",
      "feature/two/segments",
      "feature/accentué",
    ])
      assert.equal(isConventionalBranch(bad), false, `"${bad}" should have been refused`);
  });
});

describe("asBranchType", () => {
  it("lets the three types through and falls back to `chore` for everything else", () => {
    for (const t of BRANCH_TYPES) assert.equal(asBranchType(t), t);
    for (const junk of [undefined, null, "", "feat", "FEATURE", 42, {}])
      assert.equal(asBranchType(junk), BRANCH_TYPE.chore);
  });
});
