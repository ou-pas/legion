// The decision behind binary `fs_write`, checked. The module ships in the session image and is
// imported as is: THE CODE THAT RUNS is what is tested (like stuck.test.ts and
// commit-convention.test.ts next door).
//
// These tests hold the line between the three ways to provide content (exactly one must win), and
// the fact that `localPath` NEVER makes the model read the disk: `readFile`, injected here as a spy,
// plays that role.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWritePayload } from "../../../runner-payload/fs-write-payload.mjs";

const boom = () => {
  throw new Error("ENOENT: no such file");
};

describe("resolveWritePayload: content / contentBase64 / localPath", () => {
  it("lets `content` alone through, unchanged", () => {
    const input = { path: "/artifacts/x/note.md", content: "hello" };
    const r = resolveWritePayload(input, boom);
    assert.deepEqual(r, { ok: true, payload: input });
  });

  it("lets `contentBase64` alone through, unchanged", () => {
    const input = { path: "/artifacts/x/pic.png", contentBase64: "aGVsbG8=" };
    const r = resolveWritePayload(input, boom);
    assert.deepEqual(r, { ok: true, payload: input });
  });

  it("refuses when none of the three is provided", () => {
    const r = resolveWritePayload({ path: "/artifacts/x/empty.md" }, boom);
    assert.equal(r.ok, false);
    assert.match(r.reason, /provide exactly one/);
  });

  it("refuses when several are provided at once", () => {
    const r = resolveWritePayload({ path: "/p", content: "a", contentBase64: "Yg==" }, boom);
    assert.equal(r.ok, false);
    assert.match(r.reason, /provide exactly one/);
  });

  it("also refuses content + localPath together (not only the two binary ones)", () => {
    const r = resolveWritePayload({ path: "/p", content: "a", localPath: "/tmp/x.jpg" }, boom);
    assert.equal(r.ok, false);
  });

  it("localPath: reads through the injected reader, encodes base64, and drops localPath from the payload", () => {
    const read = (p: string) => {
      assert.equal(p, "/tmp/shot.jpg");
      return Buffer.from("hello");
    };
    const r = resolveWritePayload(
      { path: "/artifacts/x/shot.jpg", localPath: "/tmp/shot.jpg" },
      read,
    );
    assert.deepEqual(r, {
      ok: true,
      payload: {
        path: "/artifacts/x/shot.jpg",
        contentBase64: Buffer.from("hello").toString("base64"),
      },
    });
  });

  it("localPath: a failing read is a readable refusal, not a thrown exception", () => {
    const r = resolveWritePayload({ path: "/p", localPath: "/tmp/missing.jpg" }, boom);
    assert.equal(r.ok, false);
    assert.match(r.reason, /cannot read localPath/);
    assert.match(r.reason, /ENOENT/);
  });
});
