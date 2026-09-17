// The only write of `notifiers.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-notifiers-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { logNotifierFailure } = await import("./notifiers-store.js");
const { listControlEvents } = await import("../shared/db.js");

it("logs a notifier failure as a control event", () => {
  logNotifierFailure("i1", "Discord unavailable");
  const [event] = listControlEvents({ level: "error" });
  assert.equal(event?.source, "notify");
  assert.match(event?.message ?? "", /Discord unavailable/);
});
