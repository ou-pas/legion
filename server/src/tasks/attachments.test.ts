// An attachment is an operator input, stored under a prefix that sets it apart from an agent
// deliverable, under a named cap, with a name brought back to a file name's alphabet without
// refusing the gesture over an accent. The domain alone, no Hono or database: these rules depend on
// no transport.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-attachments-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => {
  /* temporary folder: left to the system, like the other disk tests */
});

const {
  ATTACHMENTS_SUBDIR,
  MAX_ATTACHMENT_BYTES,
  attachmentFile,
  attachmentName,
  attachmentSteerText,
  briefAttachmentsSection,
  listAttachments,
  removeAttachment,
  saveAttachment,
} = await import("./attachments.js");

const PATH = "/artifacts/run-1";

const fresh = (): string => mkdtempSync(join(dir, "run-"));

describe("attachmentName: sanitise without refusing the gesture", () => {
  it("keeps an already clean name as is (idempotence: the routes re-read that very name)", () => {
    assert.equal(attachmentName("capture-board.png"), "capture-board.png");
    assert.equal(attachmentName(attachmentName("capture-board.png")), "capture-board.png");
  });

  // The accented name is deliberate: a real operator file name is what must survive.
  it("brings back a real operator file name: accents, spaces, apostrophe", () => {
    const got = attachmentName("Capture d'écran 2026-09-02 à 10.32.png");
    assert.equal(got, "Capture-d-ecran-2026-09-02-a-10.32.png");
    assert.equal(attachmentName(got), got, "the second pass must return the same name");
  });

  it("a path is not a name: only the last segment survives, and no `..` escapes", () => {
    assert.equal(attachmentName("../../etc/passwd"), "passwd");
    assert.equal(attachmentName("/home/operator/notes.md"), "notes.md");
    assert.equal(attachmentName("dossier\\sous\\note.md"), "note.md");
  });

  it("returns null when nothing is left to store", () => {
    assert.equal(attachmentName(""), null);
    assert.equal(attachmentName("..."), null);
    assert.equal(attachmentName(undefined), null);
  });
});

describe("saveAttachment: the operator's file, under its prefix", () => {
  it("stores under attachments/, never at the run folder's root", () => {
    const run = fresh();
    const res = saveAttachment(
      run,
      PATH,
      "notes.md",
      Buffer.from("# read me\n").toString("base64"),
    );
    assert.ok(res.ok, !res.ok ? res.reason : "");
    assert.deepEqual(readdirSync(run), [ATTACHMENTS_SUBDIR]);
    assert.equal(readFileSync(join(run, ATTACHMENTS_SUBDIR, "notes.md"), "utf8"), "# read me\n");
    assert.equal(
      res.attachment.path,
      `${PATH}/attachments/notes.md`,
      "the path announced to the agent",
    );
    assert.equal(res.attachment.kind, "text");
    assert.equal(res.replaced, false);
  });

  it("an image's bytes land intact, and the type is the extension's", () => {
    const run = fresh();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const res = saveAttachment(run, PATH, "capture.png", png.toString("base64"));
    assert.ok(res.ok, !res.ok ? res.reason : "");
    assert.deepEqual(readFileSync(join(run, ATTACHMENTS_SUBDIR, "capture.png")), png);
    assert.equal(res.attachment.kind, "image");
    assert.equal(res.attachment.mimeType, "image/png");
    assert.equal(res.attachment.size, png.length);
  });

  it("refuses beyond the cap, and the refusal names the cap", () => {
    const run = fresh();
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 3);
    const res = saveAttachment(run, PATH, "too-big.bin", big.toString("base64"));
    assert.ok(!res.ok);
    assert.match(res.reason, new RegExp(`${MAX_ATTACHMENT_BYTES}`));
    assert.match(res.reason, /too-big\.bin/);
  });

  it("refuses an empty file and missing content, saying so", () => {
    const run = fresh();
    assert.equal(saveAttachment(run, PATH, "empty.png", "").ok, false);
    assert.equal(saveAttachment(run, PATH, "empty.png", undefined).ok, false);
    assert.equal(saveAttachment(run, PATH, "   ", "aGk=").ok, false);
  });

  it("attaching the same name twice replaces, and says so: no invented capture-2.png", () => {
    const run = fresh();
    saveAttachment(run, PATH, "capture.png", Buffer.from("one").toString("base64"));
    const second = saveAttachment(run, PATH, "capture.png", Buffer.from("two").toString("base64"));
    assert.ok(second.ok);
    assert.equal(second.replaced, true);
    assert.equal(readFileSync(join(run, ATTACHMENTS_SUBDIR, "capture.png"), "utf8"), "two");
    assert.equal(listAttachments(run, PATH).length, 1);
  });
});

describe("listAttachments: what the screen and the brief read", () => {
  it("empty when nothing was attached (no exception, no folder created for nothing)", () => {
    assert.deepEqual(listAttachments(fresh(), PATH), []);
  });

  it("only sees the subfolder: an agent deliverable dropped at the root does not get in", () => {
    const run = fresh();
    writeFileSync(join(run, "pr.md"), "# agent deliverable");
    saveAttachment(run, PATH, "brief.png", Buffer.from("x").toString("base64"));
    assert.deepEqual(
      listAttachments(run, PATH).map((a) => a.name),
      ["brief.png"],
    );
  });

  it("sorts by name: a readdir order is not an order", () => {
    const run = fresh();
    for (const n of ["zeta.md", "alpha.md", "mid.md"])
      saveAttachment(run, PATH, n, Buffer.from("x").toString("base64"));
    assert.deepEqual(
      listAttachments(run, PATH).map((a) => a.name),
      ["alpha.md", "mid.md", "zeta.md"],
    );
  });

  it("ignores a stray subfolder", () => {
    const run = fresh();
    mkdirSync(join(run, ATTACHMENTS_SUBDIR, "sub"), { recursive: true });
    assert.deepEqual(listAttachments(run, PATH), []);
  });
});

describe("attachmentFile / removeAttachment", () => {
  it("a missing name returns no path, and deleting it fails cleanly", () => {
    const run = fresh();
    assert.equal(attachmentFile(run, "absent.png"), null);
    assert.deepEqual(removeAttachment(run, "absent.png"), { ok: false });
  });

  it("a traversal never leaves the subfolder", () => {
    const run = fresh();
    writeFileSync(join(run, "pr.md"), "deliverable");
    // `../pr.md` really exists on disk: that makes the test conclusive.
    assert.equal(attachmentFile(run, "../pr.md"), null);
  });

  it("deletes what was attached, and nothing else", () => {
    const run = fresh();
    saveAttachment(run, PATH, "a.md", Buffer.from("a").toString("base64"));
    saveAttachment(run, PATH, "b.md", Buffer.from("b").toString("base64"));
    assert.deepEqual(removeAttachment(run, "a.md"), { ok: true });
    assert.deepEqual(
      listAttachments(run, PATH).map((x) => x.name),
      ["b.md"],
    );
  });
});

describe("briefAttachmentsSection: what the agent reads", () => {
  it("no attachment: no section, not a section saying none", () => {
    assert.equal(briefAttachmentsSection([]), null);
  });

  it("names the files, says they come from the operator, and gives the path to read", () => {
    const run = fresh();
    saveAttachment(run, PATH, "capture.png", Buffer.from("x").toString("base64"));
    saveAttachment(run, PATH, "notes.md", Buffer.from("y").toString("base64"));
    const text = briefAttachmentsSection(listAttachments(run, PATH));
    assert.ok(text);
    assert.match(text, /2 attachments/);
    assert.match(text, /capture\.png, notes\.md/);
    assert.match(text, /OPERATOR/);
    assert.match(text, new RegExp(`${PATH}/attachments/capture\\.png`));
    assert.match(text, /fs_read/);
  });

  it('uses the singular: one attachment is not "1 attachments"', () => {
    const run = fresh();
    saveAttachment(run, PATH, "alone.md", Buffer.from("x").toString("base64"));
    assert.match(briefAttachmentsSection(listAttachments(run, PATH)) ?? "", /1 attachment,/);
  });
});

describe("attachmentSteerText: what the running agent reads when a file arrives later", () => {
  it("speaks the brief's language: OPERATOR, the exact path, fs_read", () => {
    const run = fresh();
    const saved = saveAttachment(
      run,
      PATH,
      "forgotten-capture.png",
      Buffer.from("x").toString("base64"),
    );
    assert.ok(saved.ok);
    const text = attachmentSteerText([saved.attachment]);
    assert.match(text, /OPERATOR/);
    assert.match(text, new RegExp(`${PATH}/attachments/forgotten-capture\\.png`));
    assert.match(text, /fs_read/);
    assert.match(text, /image\/png/);
  });
});
