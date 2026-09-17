// An artifact's type by extension; see mime.ts for why (svg stays "text", the unknown becomes
// "binary" and never implicit HTML).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artifactKind, artifactMimeType } from "./mime.js";

describe("artifactMimeType: never text/html by default for an unknown", () => {
  it("established text types keep their content-type", () => {
    assert.equal(artifactMimeType("pr.md"), "text/plain; charset=utf-8");
    assert.equal(artifactMimeType("slices.json"), "application/json");
    assert.equal(artifactMimeType("diagram.svg"), "image/svg+xml");
    assert.equal(artifactMimeType("report.csv"), "text/csv; charset=utf-8");
    assert.equal(artifactMimeType("index.html"), "text/html; charset=utf-8");
  });

  it("images have their own content-type, never text/plain", () => {
    assert.equal(artifactMimeType("capture.png"), "image/png");
    assert.equal(artifactMimeType("photo.JPG"), "image/jpeg"); // case-insensitive extension
    assert.equal(artifactMimeType("photo.jpeg"), "image/jpeg");
    assert.equal(artifactMimeType("anim.gif"), "image/gif");
    assert.equal(artifactMimeType("shot.webp"), "image/webp");
  });

  it("an unknown (or missing) extension becomes octet-stream, never text/html", () => {
    assert.equal(artifactMimeType("export.zip"), "application/octet-stream");
    assert.equal(artifactMimeType("noextension"), "application/octet-stream");
    // The tricky case: a binary disguised as a page must never land here as implicit HTML; only a
    // real .html extension grants it (tested above), never a default.
  });
});

describe("artifactKind: what the screen can preview safely", () => {
  it("established text", () => {
    for (const n of ["a.md", "a.txt", "a.json", "a.svg", "a.csv", "a.html"])
      assert.equal(artifactKind(n), "text");
  });
  it("image", () => {
    for (const n of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp"])
      assert.equal(artifactKind(n), "image");
  });
  it("everything else: binary, offered as a download", () => {
    for (const n of ["a.zip", "a.pdf", "a"]) assert.equal(artifactKind(n), "binary");
  });
});
