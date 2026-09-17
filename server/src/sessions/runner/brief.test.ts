// The two decisions taken before the agent writes a line (lot 11). The full brief is checked
// elsewhere against a real task (commit-convention.test.ts, artifacts-location.test.ts,
// attachments-spec.test.ts, read-only-task.test.ts); this file holds what the split made callable.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeGrants, writesPrDraft } from "./brief.js";

const task = (over: Record<string, unknown> = {}) =>
  ({ readOnly: false, externalRef: null, ...over }) as never;
const agent = (over: Record<string, unknown> = {}) =>
  ({ repoAccess: "write", repoNames: JSON.stringify(["legion"]), ...over }) as never;

describe("writesPrDraft: who must write a pr.md", () => {
  it("yes for an ordinary task of an agent writing to a granted repository", () => {
    assert.equal(writesPrDraft(task(), agent()), true);
  });

  it("no for a read-only task: nothing will be pushed, a pr.md would be a false signal", () => {
    assert.equal(writesPrDraft(task({ readOnly: true }), agent()), false);
  });

  it("no without write access to the repositories", () => {
    assert.equal(writesPrDraft(task(), agent({ repoAccess: "read" })), false);
    assert.equal(writesPrDraft(task(), agent({ repoAccess: "none" })), false);
  });

  it("no without any granted repository: nowhere to push", () => {
    assert.equal(writesPrDraft(task(), agent({ repoNames: "[]" })), false);
  });

  it("no for a review-comment fix: its PR already exists", () => {
    const ref = JSON.stringify({ provider: "github-comment", identifier: "#12", url: "u" });
    assert.equal(writesPrDraft(task({ externalRef: ref }), agent()), false);
  });

  it("yes for a linked issue: it has no PR yet", () => {
    const ref = JSON.stringify({ provider: "linear", identifier: "ENG-1", url: "u" });
    assert.equal(writesPrDraft(task({ externalRef: ref }), agent()), true);
  });
});

describe("describeGrants: what the agent reads about its disk grants", () => {
  const withGrants = (grants: unknown[]) => ({ fsGrants: JSON.stringify(grants) }) as never;

  it("says so in plain words when there are none", () => {
    // A refusal the agent does not understand is a wasted turn: "None" beats an empty string.
    assert.equal(describeGrants(withGrants([])), "None — you have no filesystem access.");
  });

  it("lists each folder with the granted verbs, and nothing more", () => {
    const text = describeGrants(
      withGrants([
        { folderPath: "/agents/server", canRead: true, canWrite: true, canDelete: false },
      ]),
    );
    assert.match(text, /- \/agents\/server \(read, write\)/);
    assert.doesNotMatch(text, /delete/);
  });

  it("announces where relative paths resolve, otherwise the agent guesses at its own cost", () => {
    const text = describeGrants(
      withGrants([{ folderPath: "/a", canRead: true, canWrite: false, canDelete: false }]),
    );
    assert.match(text, /Relative paths in fs tools resolve to your first writable folder\./);
  });
});
