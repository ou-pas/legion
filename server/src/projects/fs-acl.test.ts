// Where an agent's relative path lands (bug of 23/08). `pr.md` written relatively went to the
// agent's personal folder ("first write-granted folder") instead of the session's artifacts: no
// artifact on screen, no PR button, while the agent believed it had delivered. Seen on Obs 4
// (62UaFiRvWg). Rule tested: relative → session work folder, always; absolute → unchanged, and the
// ACL decides. Grant order must never decide a destination.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorize, resolveAgentPath, type FsGrant } from "./fs-acl.js";

const AGENT_HOME: FsGrant = {
  folderPath: "/agents/server",
  canRead: true,
  canWrite: true,
  canDelete: false,
};
const ARTIFACTS: FsGrant = {
  folderPath: "/artifacts/t1",
  canRead: true,
  canWrite: true,
  canDelete: false,
};

describe("resolveAgentPath: relative → work folder, never list order", () => {
  it("pr.md goes to the session's artifacts", () => {
    assert.equal(resolveAgentPath("pr.md", "/artifacts/t1"), "/artifacts/t1/pr.md");
  });

  it("a relative subpath follows the same rule", () => {
    assert.equal(
      resolveAgentPath("notes/decision.md", "/artifacts/t1"),
      "/artifacts/t1/notes/decision.md",
    );
  });

  it("an absolute path does not move: writing to the personal folder stays possible by naming it", () => {
    assert.equal(
      resolveAgentPath("/agents/server/guide.md", "/artifacts/t1"),
      "/agents/server/guide.md",
    );
  });

  it("empty path: returned as is (the ACL refuses it downstream)", () => {
    assert.equal(resolveAgentPath("", "/artifacts/t1"), "");
  });
});

describe("authorize: the ACL after resolution (grant order changes nothing)", () => {
  it("the resolved pr.md is writable through the artifacts grant, whatever the order", () => {
    const p = resolveAgentPath("pr.md", "/artifacts/t1");
    for (const grants of [
      [AGENT_HOME, ARTIFACTS],
      [ARTIFACTS, AGENT_HOME],
    ]) {
      const r = authorize(grants, "write", p);
      assert.ok(r.ok, "write expected to be allowed");
      assert.equal(r.ok && r.clean, "/artifacts/t1/pr.md");
    }
  });

  it("the personal folder stays writable by absolute path", () => {
    const r = authorize([AGENT_HOME, ARTIFACTS], "write", "/agents/server/guide.md");
    assert.ok(r.ok);
  });

  it("outside every grant: a named refusal", () => {
    const r = authorize([AGENT_HOME, ARTIFACTS], "write", "/artifacts/OTHER/pr.md");
    assert.ok(!r.ok);
  });
});
