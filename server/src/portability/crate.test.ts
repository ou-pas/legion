// The crate format (26/08).
//
// The priority is not "it encrypts" but that the failures give distinct messages. Not a crate, a
// future-version crate, and a wrong passphrase or damaged body look alike from here; if all said
// "wrong passphrase", one would spend an hour doubting a phrase typed correctly.
//
// `WORK` lowers the `scrypt` cost for this suite only. Parameters travel in the header, so opening
// needs no knowledge of it: the same function runs in tests and production.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CRATE_FORMAT, PASSPHRASE_MIN, crateFilename, openCrate, sealCrate } from "./crate.js";

const WORK = 1024;
const PASS = "a whole sentence that holds";
const DATA = { project: { name: "Legion" }, secrets: [{ name: "GITHUB_TOKEN", value: "ghp_x" }] };

/** A crate is "header \n body". Split once here rather than in each test. */
function parts(sealed: string): [string, string] {
  const cut = sealed.indexOf("\n");
  return [sealed.slice(0, cut), sealed.slice(cut + 1).trim()];
}

describe("a crate seals and reopens", () => {
  it("returns exactly what went in", () => {
    const opened = openCrate(sealCrate(DATA, PASS, WORK), PASS);
    assert.deepEqual(opened, DATA);
  });

  it("the header is readable and says nothing about the project", () => {
    // Found on a USB stick, the file must not reveal where it came from.
    const header = JSON.parse(parts(sealCrate(DATA, PASS, WORK))[0]) as Record<string, unknown>;
    assert.equal(header.aos, CRATE_FORMAT);
    assert.equal(header.kdf, "scrypt");
    assert.deepEqual(Object.keys(header).sort(), ["N", "aos", "kdf", "nonce", "p", "r", "salt"]);
    assert.equal(JSON.stringify(header).includes("Legion"), false);
  });

  it("two crates of the same content differ", () => {
    // Fresh salt and nonce each time, or comparing two exports would tell that nothing changed.
    const a = sealCrate(DATA, PASS, WORK),
      b = sealCrate(DATA, PASS, WORK);
    assert.notEqual(a, b);
  });
});

describe("the four refusals, and what each says", () => {
  it("wrong passphrase", () => {
    assert.throws(
      () => openCrate(sealCrate(DATA, PASS, WORK), "another whole sentence"),
      /wrong passphrase, or damaged file/,
    );
  });

  it("body changed by a single character", () => {
    // GCM authenticates. The message matches the wrong-passphrase one on purpose: nothing can
    // tell the two apart.
    const [head, body] = parts(sealCrate(DATA, PASS, WORK));
    const flipped = body[10] === "A" ? "B" : "A";
    assert.throws(
      () => openCrate(`${head}\n${body.slice(0, 10)}${flipped}${body.slice(11)}`, PASS),
      /wrong passphrase, or damaged file/,
    );
  });

  it("not a crate at all", () => {
    assert.throws(() => openCrate("hello\nthis is some text", PASS), /is not a Legion crate/);
    assert.throws(() => openCrate("a single line", PASS), /is not a Legion crate/);
  });

  it("a future-version crate says so instead of failing on the passphrase", () => {
    const [head, body] = parts(sealCrate(DATA, PASS, WORK));
    const future = JSON.parse(head) as Record<string, unknown>;
    future.aos = CRATE_FORMAT + 1;
    assert.throws(
      () => openCrate(`${JSON.stringify(future)}\n${body}`, PASS),
      /this version only reads format/,
    );
  });
});

describe("a crate from elsewhere is a hostile file", () => {
  it("refuses oversized derivation parameters before deriving", () => {
    // Otherwise three lines of text would ask for tens of GB and kill the control plane, with no
    // passphrase needed.
    const [head, body] = parts(sealCrate(DATA, PASS, WORK));
    const hostile = JSON.parse(head) as Record<string, unknown>;
    hostile.N = 1 << 30;
    assert.throws(() => openCrate(`${JSON.stringify(hostile)}\n${body}`, PASS), /out of bounds/);
  });

  it("refuses an N that is not a power of two", () => {
    const [head, body] = parts(sealCrate(DATA, PASS, WORK));
    const bad = JSON.parse(head) as Record<string, unknown>;
    bad.N = 1000;
    assert.throws(() => openCrate(`${JSON.stringify(bad)}\n${body}`, PASS), /out of bounds/);
  });
});

describe("the passphrase has a floor", () => {
  it("too short is refused at sealing, not a weak crate", () => {
    assert.throws(
      () => sealCrate(DATA, "short", WORK),
      new RegExp(`at least ${PASSPHRASE_MIN} characters`),
    );
  });

  it("exactly the minimum passes", () => {
    const pass = "a".repeat(PASSPHRASE_MIN);
    assert.deepEqual(openCrate(sealCrate(DATA, pass, WORK), pass), DATA);
  });

  it("accents composed differently open the same crate", () => {
    // Same phrase, two Unicode encodings; the accented French text is deliberate. Without
    // normalisation a crate sealed on one keyboard was unreadable on another.
    const composed = "phrase de très bon niveau";
    const decomposed = "phrase de très bon niveau";
    assert.notEqual(composed, decomposed); // really two different byte sequences
    assert.deepEqual(openCrate(sealCrate(DATA, composed, WORK), decomposed), DATA);
  });
});

describe("the file name", () => {
  it("carries the slug and the day, not the time", () => {
    assert.equal(crateFilename("legion", new Date(2026, 7, 26)), "legion-legion-20260826.aos");
  });

  it("cleans a slug that is not one", () => {
    assert.equal(
      crateFilename("My Project !", new Date(2026, 7, 26)),
      "legion-my-project-20260826.aos",
    );
  });
});
