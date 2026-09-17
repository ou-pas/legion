// `control-log-store.ts` must re-export the very `logControlEvent` of `shared/db.ts`, not a copy
// or an adapter. The function's own behaviour is covered by `shared/control-log.test.ts`; this
// test only guards the wire between the two.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-control-log-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { logControlEvent: dbLogControlEvent } = await import("../shared/db.js");
const { logControlEvent } = await import("./control-log-store.js");

describe("control-log-store", () => {
  it("re-exports the same function as shared/db.js, without a wrapper", () => {
    assert.equal(logControlEvent, dbLogControlEvent);
  });
});
