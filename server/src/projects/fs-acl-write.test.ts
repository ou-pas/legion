// Binary writes (slice "artifacts accept binary", 02/09): `fsExec` forced "utf8" on `write`, so a PNG
// passed as `content` came out silently corrupt. `contentBase64` is decoded to raw bytes and written
// with no encoding; the sha256 comparison proves the same bytes land.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fsExec } from "./fs-acl.js";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const dir = mkdtempSync(join(tmpdir(), "legion-fsexec-binary-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// A real 1x1 PNG: its signature `\x89PNG\r\n\x1a\n` is not valid UTF-8, the exact case "utf8" broke.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("fsExec: binary write (contentBase64), identical bytes", () => {
  it("a PNG written via contentBase64 reads back bit for bit (stable sha256)", () => {
    const res = fsExec(dir, "write", "/capture.png", { contentBase64: PNG.toString("base64") });
    assert.ok(res.ok, `write refused: ${!res.ok && res.reason}`);
    const onDisk = readFileSync(join(dir, "capture.png"));
    assert.equal(sha256(onDisk), sha256(PNG));
    assert.equal(onDisk.length, PNG.length);
  });

  it("writing the same PNG via text `content` would corrupt it: contentBase64 is not cosmetic", () => {
    // A JS string is not bytes: re-encoding "as before" (utf8) changes the size.
    const asString = PNG.toString("binary"); // what the old code received and wrote as is
    const reencoded = Buffer.from(asString, "utf8");
    assert.notEqual(
      reencoded.length,
      PNG.length,
      "utf8 reinterpretation must change the size, or this test proves nothing",
    );
  });

  it("refuses beyond the named cap, and says so", () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 1); // > 8 MB
    const res = fsExec(dir, "write", "/too-big.bin", { contentBase64: big.toString("base64") });
    assert.ok(!res.ok);
    assert.match(res.reason, /binary content too large \(\d+ > 8388608\)/);
  });

  it("a write under the cap passes: a typical 2 MB screenshot is well below", () => {
    const screenshot = Buffer.alloc(2 * 1024 * 1024, 7);
    const res = fsExec(dir, "write", "/screenshot.png", {
      contentBase64: screenshot.toString("base64"),
    });
    assert.ok(res.ok);
  });

  it("text `content` is unchanged when contentBase64 is absent", () => {
    const res = fsExec(dir, "write", "/note.md", { content: "# title\n" });
    assert.ok(res.ok);
    assert.equal(readFileSync(join(dir, "note.md"), "utf8"), "# title\n");
  });
});
