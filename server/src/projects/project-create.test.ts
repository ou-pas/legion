// `POST /api/projects` writes four rows (project, environment, "main" repository, default agent) or
// none (05/09). They used to be four bare INSERTs. No schema constraint can make the last one fail,
// which is why the defect stayed hidden: it took a failure to find it, and a failure left a project
// without an agent. The SQLite trigger below plays that failure where it would do most damage.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-project-create-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
// No allowlist (08/09): project creation no longer reads `LEGION_FORGE_HOSTS`. What stays refused
// over https is an unguessable forge, a guarantee that depends on no setting.
delete process.env.LEGION_FORGE_HOSTS;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerProjectRoutes } = await import("./routes.js");

const app = new Hono();
registerProjectRoutes(app);
// A failure in the route surfaces as a readable 500 rather than Hono printing it to the console.
app.onError((err, c) => c.json({ error: err.message }, 500));

const post = (body: unknown) =>
  app.request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const count = (table: typeof schema.environments | typeof schema.repos | typeof schema.agents) =>
  db.select().from(table).all().length;

describe("POST /api/projects: all or nothing", () => {
  it("creates the project, its environment, its main repository and its default agent", async () => {
    const res = await post({ name: "Kopee", repoUrl: "https://github.com/acme/kopee" });
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: string };
    assert.equal(
      db.select().from(schema.environments).where(eq(schema.environments.projectId, id)).all()
        .length,
      1,
    );
    const repos = db.select().from(schema.repos).where(eq(schema.repos.projectId, id)).all();
    assert.deepEqual(
      repos.map((r) => r.name),
      ["main"],
    );
    const agents = db.select().from(schema.agents).where(eq(schema.agents.projectId, id)).all();
    assert.deepEqual(
      agents.map((a) => a.name),
      ["default"],
    );
  });

  it("if the default agent cannot be inserted, none of the earlier rows remain", async () => {
    const before = {
      environments: count(schema.environments),
      repos: count(schema.repos),
      agents: count(schema.agents),
    };
    db.run(
      sql`CREATE TRIGGER agents_refuse BEFORE INSERT ON agents BEGIN SELECT RAISE(ABORT, 'test refusal'); END`,
    );
    try {
      const res = await post({ name: "Orphan", repoUrl: "https://github.com/acme/orphan" });
      assert.equal(res.status, 500);
      assert.match(((await res.json()) as { error: string }).error, /test refusal/);
    } finally {
      db.run(sql`DROP TRIGGER agents_refuse`);
    }
    assert.equal(
      db.select().from(schema.projects).where(eq(schema.projects.slug, "orphan")).get(),
      undefined,
    );
    assert.deepEqual(
      {
        environments: count(schema.environments),
        repos: count(schema.repos),
        agents: count(schema.agents),
      },
      before,
      "the environment and repository inserted before the agent went with it",
    );
  });
});

// The second door (06/09, audit wave 2). `POST /api/repos` checked the host since wave 1; this one,
// the UI's most common path, wrote its main repository unchecked.
describe("POST /api/projects: the initial repository URL passes the same guard as POST /api/repos", () => {
  const slugs = () =>
    db
      .select()
      .from(schema.projects)
      .all()
      .map((p) => p.slug);

  it("a public forge passes", async () => {
    assert.equal(
      (await post({ name: "Public", repoUrl: "https://github.com/acme/public" })).status,
      201,
    );
  });

  it("an SSH URL passes, its forge to be set later since the host does not give it", async () => {
    const res = await post({ name: "Declared", repoUrl: "git@framagit.org:acme/declared.git" });
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  });

  it("an https URL with an unguessable forge is refused, and no project is created", async () => {
    // The guarantee that survived removing the allowlist (08/09): without a forge there is no way to
    // know which token to present, so none is. The refusal names the host and the next step.
    const before = slugs();
    const res = await post({ name: "Elsewhere", repoUrl: "https://git.perso.example/acme/x.git" });
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /git\.perso\.example/);
    assert.match(error, /unknown forge/);
    assert.deepEqual(slugs(), before, "the refusal comes before the transaction");
  });

  it("a URL carrying credentials is refused here too", async () => {
    const res = await post({ name: "Leak", repoUrl: "https://user:ghp_x@github.com/acme/x.git" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /credential/);
  });

  it("an invented key is refused by name, not silently dropped", async () => {
    const res = await post({ name: "Typo", repoUrI: "https://github.com/acme/x.git" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /repoUrI/);
  });
});
