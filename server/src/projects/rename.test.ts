// The name always changes, the identifier follows when it can, and a refusal names the real cause.
// A message naming the wrong blocker sends someone to fix what was not the problem.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slugMove, slugOf, validateProjectName } from "./rename.js";

const base = {
  current: "acme",
  wanted: "acme-v2",
  taken: false,
  isSelf: false,
  fsRootExplicit: false,
  hasSessions: false,
  fsHasContent: false,
};

describe("slugOf: the same formula as at creation", () => {
  it("lowercase, dashes, nothing else", () => {
    assert.equal(slugOf("Acme V2"), "acme-v2");
    assert.equal(slugOf("  Front & Back  "), "front-back");
    assert.equal(slugOf("Éditeur"), "diteur"); // deliberate accented input: the original formula does no accent folding
  });

  it("a name with no letter or digit produces nothing: what the validator catches", () => {
    assert.equal(slugOf("!!!"), "");
  });
});

describe("validateProjectName", () => {
  it("accepts a normal name", () => {
    assert.equal(validateProjectName("Acme"), null);
  });

  it("refuses empty", () => {
    assert.match(validateProjectName("   ")!, /needs a name/);
  });

  it("refuses a name that cannot become an identifier", () => {
    // Otherwise the project could not be exported: `crateFilename` starts from the slug.
    assert.match(validateProjectName("★★★")!, /identifier/);
  });

  it("refuses a name too long", () => {
    assert.match(validateProjectName("x".repeat(81))!, /too long/);
  });
});

describe("slugMove: when the identifier follows", () => {
  it("a new project: nothing to move, it follows", () => {
    assert.deepEqual(slugMove(base), { move: true });
  });

  it("the same slug is not a move", () => {
    // "Acme" → "ACME": the name changes, the slug is identical. Nothing to refuse.
    assert.deepEqual(slugMove({ ...base, wanted: "acme" }), { move: true });
  });

  it("with an explicit fsRoot it follows even with sessions: the slug names no path", () => {
    // `projectRoot(slug, fsRoot)` returns fsRoot and ignores the slug; refusing would be an
    // imaginary blocker.
    const v = slugMove({ ...base, fsRootExplicit: true, hasSessions: true, fsHasContent: true });
    assert.deepEqual(v, { move: true });
  });

  it("sessions block, and the message says why", () => {
    const v = slugMove({ ...base, hasSessions: true });
    assert.equal(v.move, false);
    assert.match((v as { reason: string }).reason, /already has sessions/);
    assert.match((v as { reason: string }).reason, /acme/);
  });

  it("a non-empty folder blocks even without a session", () => {
    // An agent `fs_write`, a hand-dropped artifact: the database does not know, the disk does.
    const v = slugMove({ ...base, fsHasContent: true });
    assert.equal(v.move, false);
    assert.match((v as { reason: string }).reason, /is not empty/);
  });

  it("a taken slug blocks, and is named", () => {
    const v = slugMove({ ...base, taken: true });
    assert.equal(v.move, false);
    assert.match((v as { reason: string }).reason, /“acme-v2” is already taken/);
  });

  it("the Legion project never changes identifier", () => {
    // `seed/self.ts` finds it by slug: changing it would create a second Legion project at the
    // next boot.
    const v = slugMove({ ...base, current: "legion", isSelf: true });
    assert.equal(v.move, false);
    assert.match((v as { reason: string }).reason, /recognises itself by/);
  });

  it("refusal order names the real blocker, not the first found", () => {
    // Three blockers at once: "Legion project" is what must be heard. "Slug taken" would send
    // someone to free a slug for nothing.
    const v = slugMove({
      ...base,
      current: "legion",
      isSelf: true,
      taken: true,
      hasSessions: true,
    });
    assert.match((v as { reason: string }).reason, /recognises itself by/);
  });
});
