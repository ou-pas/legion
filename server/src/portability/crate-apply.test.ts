// A crate is an input like any other (06/09, audit wave 2).
//
// It is the third way a `repos` row enters the database, and the only one whose content does not
// even come from the UI: a file written on another machine. It used to write repositories without
// checking the host, so nothing stopped the project token being presented to whatever host the file
// named (the GitLab API host is read from the repository URL, `gitlab.ts` `apiBase`, and the
// control plane has no proxy in front of it).
//
// The refusal sits in `summarizeCrate`, so the preview already shows it. Both functions are checked.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-crate-apply-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY ??= "test-only-key-for-this-suite";
process.env.LEGION_FORGE_HOSTS = "framagit.org";
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { applyCrate, summarizeCrate } = await import("./crate-apply.js");

/** The minimal crate carrying one repository: the URL is what is judged. */
const crateWith = (url: string, name = "web") => ({
  format: 1,
  project: { name: `Crate ${name} ${Math.random().toString(36).slice(2, 7)}` },
  repos: [{ name, url }],
});

const reposOf = (projectId: string) =>
  db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();

describe("the host of a crate's repositories", () => {
  it("accepts a public forge", () => {
    const { projectId } = applyCrate(crateWith("https://github.com/org/web.git"));
    assert.deepEqual(
      reposOf(projectId).map((r) => r.url),
      ["https://github.com/org/web.git"],
    );
  });

  it("accepts a host declared in LEGION_FORGE_HOSTS", () => {
    const { projectId } = applyCrate(crateWith("https://framagit.org/org/api.git", "api"));
    assert.equal(reposOf(projectId).length, 1);
  });

  it("refuses an unknown host, naming the repository, the host and the variable", () => {
    assert.throws(
      () => applyCrate(crateWith("https://git.evil.example/org/x.git", "leak")),
      (e: Error) =>
        /“leak”/.test(e.message) &&
        /git\.evil\.example/.test(e.message) &&
        /LEGION_FORGE_HOSTS/.test(e.message),
    );
  });

  it("the refusal shows at preview, before confirmation is asked", () => {
    assert.throws(
      () => summarizeCrate(crateWith("https://git.evil.example/org/x.git")),
      /LEGION_FORGE_HOSTS/,
    );
  });

  it("a refused crate created nothing: the check runs before the transaction", () => {
    const before = db.select().from(schema.projects).all().length;
    assert.throws(() => applyCrate(crateWith("git@git.evil.example:org/x.git", "ssh")));
    assert.equal(db.select().from(schema.projects).all().length, before, "no project left behind");
  });

  it("a crate with no repository stays importable: the guard only judges what exists", () => {
    const { projectId } = applyCrate({ format: 1, project: { name: "No repository" } });
    assert.equal(reposOf(projectId).length, 0);
  });
});
