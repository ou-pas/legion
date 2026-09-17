// Instance settings access: writing an existing key replaces it instead of adding a second row.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-settings-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { getSetting, setSetting } = await import("./settings-store.js");

describe("settings-store", () => {
  it("returns null, never an empty string, for a key never written", () => {
    assert.equal(getSetting("never.written"), null);
  });

  it("writes then reads the value", () => {
    setSetting("webhooks.base", "https://example.test");
    assert.equal(getSetting("webhooks.base"), "https://example.test");
  });

  it("replaces a rewritten key instead of adding a second row", () => {
    setSetting("webhooks.base", "https://other.test");
    assert.equal(getSetting("webhooks.base"), "https://other.test");
  });
});
