// `project-store.ts` only reads; filtering (does it really declare an image?) stays in `project.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-project-image-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { projectById, projectImageDeclarations } = await import("./project-store.js");

const P1 = "p-img-store-1";
const P2 = "p-img-store-2";
const now = new Date();

before(() => {
  db.insert(schema.projects)
    .values({
      id: P1,
      name: "with image",
      slug: "with-image",
      createdAt: now,
      sessionImage: "legion/session:p1",
      sessionDockerfile: "FROM x\n",
    })
    .run();
  db.insert(schema.projects)
    .values({ id: P2, name: "without image", slug: "without-image", createdAt: now })
    .run();
});

describe("project-image-store", () => {
  it("projectById returns the project or undefined", () => {
    assert.equal(projectById(P1)?.id, P1);
    assert.equal(projectById("absent"), undefined);
  });

  it("projectImageDeclarations returns ALL projects, declaring or not", () => {
    const rows = projectImageDeclarations().filter((r) => [P1, P2].includes(r.id));
    assert.deepEqual(
      rows.sort((a, b) => a.id.localeCompare(b.id)),
      [
        {
          id: P1,
          name: "with image",
          sessionImage: "legion/session:p1",
          sessionDockerfile: "FROM x\n",
        },
        { id: P2, name: "without image", sessionImage: null, sessionDockerfile: null },
      ],
    );
  });
});
