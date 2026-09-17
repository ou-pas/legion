// Loading the server's project modules must not seed the author's project. `project-edit.ts` once
// imported its slug from `seed/self.ts`, a script, and every boot upserted the Legion project.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-self-slug-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
await import("./project-edit.js");

it("importing project-edit creates no project", () => {
  assert.equal(db.select().from(schema.projects).all().length, 0);
});
