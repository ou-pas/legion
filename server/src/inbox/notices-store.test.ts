// Notice persistence.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-notices-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { insertNotice, markNoticeReadRow, unreadNotices } = await import("./notices-store.js");

it("inserts an unread notice that unreadNotices returns", () => {
  insertNotice("standup", "info");
  const rows = unreadNotices();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.body, "standup");
  assert.equal(rows[0]?.read, false);
});

it("removes a notice marked read from unreadNotices", () => {
  insertNotice("to clear", "info");
  const [row] = unreadNotices().filter((n) => n.body === "to clear");
  assert.ok(row);
  markNoticeReadRow(row.id);
  assert.equal(
    unreadNotices().some((n) => n.id === row.id),
    false,
  );
});
