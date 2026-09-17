// Repository rules tested without an app (06/09, audit wave 2). `repos-routes.test.ts` still judges
// the route end to end; this covers what was unreachable while the rules lived in the handler:
// reasoned refusals (400 / 404 / 409), a single PATCH write, and cleaning agent grants when a
// repository disappears.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-repo-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
// No allowlist (08/09): `createRepo` no longer reads `LEGION_FORGE_HOSTS`. The forge the caller
// declares is authoritative; guessing it is what stays refused.
delete process.env.LEGION_FORGE_HOSTS;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { createRepo, deleteRepo, editRepo } = await import("./repo-edit.js");

const PROJECT = "prj-repo-edit";
const AGENT = "agt-repo-edit";

before(() => {
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "Kopee", slug: "kopee-edit", createdAt: new Date() })
    .run();
});

describe("createRepo", () => {
  it("inserts the row with the forge guessed from the host", () => {
    const created = createRepo({
      projectId: PROJECT,
      name: "web",
      url: " https://github.com/org/web.git ",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.forge, "github");
    assert.equal(
      created.value.url,
      "https://github.com/org/web.git",
      "the URL is cleaned before entering the database",
    );
  });

  it("404 on an imaginary project: an unenforced foreign key is not one", () => {
    const created = createRepo({
      projectId: "nowhere",
      name: "web",
      url: "https://github.com/org/web.git",
    });
    assert.deepEqual(created, { ok: false, status: 404, error: "project not found" });
  });

  it("409 on a name already taken in this project, case-insensitively", () => {
    const created = createRepo({
      projectId: PROJECT,
      name: "WEB",
      url: "https://github.com/org/other.git",
    });
    assert.equal(created.ok, false);
    assert.equal(created.ok ? 0 : created.status, 409);
  });

  it("201 on any host whose forge is declared", () => {
    const created = createRepo({
      projectId: PROJECT,
      name: "elsewhere",
      url: "https://git.perso.example/org/x.git",
      forge: "gitlab",
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
  });

  it("400 when the forge cannot be guessed over https, 201 over SSH where the key suffices", () => {
    const https = createRepo({
      projectId: PROJECT,
      name: "api",
      url: "https://framagit.org/org/api.git",
    });
    assert.equal(https.ok, false);
    assert.match(https.ok ? "" : https.error, /unknown forge/);
    const ssh = createRepo({
      projectId: PROJECT,
      name: "front",
      url: "git@framagit.org:org/front.git",
    });
    assert.equal(ssh.ok, true);
    assert.equal(
      ssh.ok ? ssh.value.forge : "?",
      null,
      "the forge will be declared later: it only serves merge requests",
    );
  });

  it("refuses a name that is not one", () => {
    const created = createRepo({
      projectId: PROJECT,
      name: "my repo",
      url: "https://github.com/org/x.git",
    });
    assert.equal(created.ok, false);
    assert.match(created.ok ? "" : created.error, /invalid name/);
  });
});

describe("editRepo", () => {
  const repoOf = (name: string) =>
    db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.projectId, PROJECT))
      .all()
      .find((r) => r.name === name);

  it("writes forge and test command in a single write", () => {
    const id = repoOf("front")?.id ?? "";
    assert.deepEqual(editRepo(id, { forge: "gitlab", testCommand: "  pnpm -s test  " }), {
      ok: true,
      value: null,
    });
    const row = repoOf("front");
    assert.equal(row?.forge, "gitlab");
    assert.equal(row?.testCommand, "pnpm -s test");
  });

  it("`testCommand: null` clears, a missing key touches nothing", () => {
    const id = repoOf("front")?.id ?? "";
    editRepo(id, { forge: "github" });
    assert.equal(
      repoOf("front")?.testCommand,
      "pnpm -s test",
      "the command survived a PATCH that did not mention it",
    );
    editRepo(id, { testCommand: null });
    assert.equal(repoOf("front")?.testCommand, null);
  });

  it("404 on an unknown repository", () => {
    assert.deepEqual(editRepo("nowhere", { forge: "github" }), {
      ok: false,
      status: 404,
      error: "repo not found",
    });
  });

  // Moving (13/09): renaming propagates the grant instead of erasing it, and the URL takes the forge
  // with it.
  it("the URL changes, normalised, and the forge follows without being declared", () => {
    const id = repoOf("front")?.id ?? "";
    assert.deepEqual(editRepo(id, { url: " https://gitlab.com/org/front.git " }), {
      ok: true,
      value: null,
    });
    const row = repoOf("front");
    assert.equal(row?.url, "https://gitlab.com/org/front.git");
    assert.equal(
      row?.forge,
      "gitlab",
      "the forge follows the host, or the clone presents the wrong one",
    );
  });

  it("a declared forge wins over the one the URL suggests", () => {
    const id = repoOf("front")?.id ?? "";
    editRepo(id, { url: "https://github.com/org/front.git", forge: "gitlab" });
    assert.equal(repoOf("front")?.forge, "gitlab");
  });

  it("refuses a URL that is not one, writing nothing", () => {
    const id = repoOf("front")?.id ?? "";
    const before = repoOf("front")?.url;
    assert.deepEqual(editRepo(id, { url: "ftp://elsewhere/x.git" }), {
      ok: false,
      status: 400,
      error: "https:// or SSH repo url required (git@host:path, ssh://…)",
    });
    assert.equal(repoOf("front")?.url, before);
  });

  it("renaming follows in agent grants: same repository", () => {
    db.insert(schema.agents)
      .values({
        id: "agt-rename",
        projectId: PROJECT,
        name: "dev-rename",
        rolePrompt: "x",
        repoNames: JSON.stringify(["front", "elsewhere"]),
        createdAt: new Date(),
      })
      .run();
    const id = repoOf("front")?.id ?? "";
    assert.deepEqual(editRepo(id, { name: "  facade  " }), { ok: true, value: null });
    assert.ok(repoOf("facade"), "the row carries the new name");
    const agent = db.select().from(schema.agents).where(eq(schema.agents.id, "agt-rename")).get();
    assert.deepEqual(
      JSON.parse(agent?.repoNames ?? "[]"),
      ["facade", "elsewhere"],
      "the grant follows the repository, the others do not move",
    );
  });

  it("refuses a name taken in the project, but not its own", () => {
    const id = repoOf("facade")?.id ?? "";
    createRepo({
      projectId: PROJECT,
      name: "neighbour",
      url: "https://github.com/org/neighbour.git",
    });
    assert.deepEqual(editRepo(id, { name: "NEIGHBOUR" }), {
      ok: false,
      status: 409,
      error: "a repo “NEIGHBOUR” already exists in this project",
    });
    assert.deepEqual(editRepo(id, { name: "facade" }), { ok: true, value: null });
  });

  it("refuses a name that cannot be a clone folder", () => {
    const id = repoOf("facade")?.id ?? "";
    assert.deepEqual(editRepo(id, { name: "../escape" }), {
      ok: false,
      status: 400,
      error: "invalid name (letters, digits, ., -, _)",
    });
  });
});

describe("deleteRepo", () => {
  it("removes the repository and its name from the project's agent grants", () => {
    db.insert(schema.agents)
      .values({
        id: AGENT,
        projectId: PROJECT,
        name: "dev",
        rolePrompt: "x",
        repoNames: JSON.stringify(["web", "front"]),
        createdAt: new Date(),
      })
      .run();
    const web = db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.projectId, PROJECT))
      .all()
      .find((r) => r.name === "web");
    deleteRepo(web?.id ?? "");
    const agent = db.select().from(schema.agents).where(eq(schema.agents.id, AGENT)).get();
    assert.deepEqual(
      JSON.parse(agent?.repoNames ?? "[]"),
      ["front"],
      "no ghost grant to a removed repository",
    );
  });

  it("removing an unknown repository does nothing and does not throw: idempotent", () => {
    assert.doesNotThrow(() => deleteRepo("nowhere"));
  });
});
