// A project round trip (26/08). The format is tested next door; this tests what gets lost on the
// way. An export that "works" but drops an agent's network policy or recreates a grant to a missing
// rule yields a project that looks right and is not. Watched here:
//
//   1. no local id travels (import creates fresh rows, no reconciliation);
//   2. links are rebuilt by name, and a name with no row disappears instead of becoming a ghost grant;
//   3. the environment always follows the agent, or `limited` falls back to `open`, a silent
//      privilege widening.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-crate-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY ??= "test-only-key-for-this-suite";
// `git.example` is these tests' self-hosted instance, declared as the operator would (06/09): an
// undeclared host makes the import fail, which `crate-apply.test.ts` checks.
process.env.LEGION_FORGE_HOSTS = "git.example";
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { encryptSecret, decryptSecret } = await import("../shared/crypto.js");
const { collectCrate, crateManifest, DEFAULT_INCLUDE } = await import("./crate-collect.js");
const { applyCrate, summarizeCrate } = await import("./crate-apply.js");
const { openCrate, sealCrate } = await import("./crate.js");
const { NETWORKING } = await import("../shared/enums.js");
const { REPO_ACCESS } = await import("../shared/enums.js");

const WORK = 1024;
const PASS = "a whole sentence that holds";
const P = "p-crate",
  ENV = "e-crate",
  AG = "a-crate",
  RULE = "r-crate",
  MCP = "m-crate";
const now = new Date();

function seedProject(): void {
  for (const t of [
    schema.agents,
    schema.secrets,
    schema.rules,
    schema.mcpServers,
    schema.repos,
    schema.taskTemplates,
    schema.environments,
    schema.projects,
  ])
    db.delete(t).run();

  db.insert(schema.projects)
    .values({
      id: P,
      name: "Atelier",
      slug: "atelier",
      defaultModel: "sonnet",
      context: "the living context",
      defaultSkillNames: JSON.stringify(["refactoring"]),
      chainBindings: JSON.stringify({ spec: AG }),
      gitAuthorName: "Legion",
      gitAuthorEmail: "bot@example.test",
      fsRoot: "/Users/someone/elsewhere",
      createdAt: now,
    })
    .run();
  db.insert(schema.environments)
    .values({
      id: ENV,
      projectId: P,
      name: "locked",
      networking: NETWORKING.limited,
      allowedHosts: JSON.stringify(["api.github.com"]),
    })
    .run();
  db.insert(schema.rules)
    .values({
      id: RULE,
      projectId: P,
      name: "always-test",
      content: "green before shipping",
      allAgents: true,
      status: "active",
      createdAt: now,
    })
    .run();
  db.insert(schema.mcpServers)
    .values({
      id: MCP,
      projectId: P,
      name: "figma",
      config: JSON.stringify({ type: "http", url: "https://x" }),
      allowedHosts: JSON.stringify(["figma.com"]),
      allAgents: false,
      createdAt: now,
    })
    .run();
  db.insert(schema.repos)
    .values({
      id: "repo-crate",
      projectId: P,
      name: "web",
      url: "https://git.example/web",
      forge: "github",
      testCommand: "pnpm test",
      createdAt: now,
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: AG,
      projectId: P,
      name: "front",
      title: "Interface",
      rolePrompt: "you build the web app",
      environmentId: ENV,
      repoAccess: REPO_ACCESS.write,
      browserAccess: true,
      inboxAccess: true,
      mcpServerIds: JSON.stringify([MCP]),
      ruleIds: JSON.stringify([RULE]),
      skillNames: JSON.stringify(["react-best-practices"]),
      repoNames: JSON.stringify(["web"]),
      envSecretNames: JSON.stringify(["GITHUB_TOKEN"]),
      createdAt: now,
    })
    .run();
  db.insert(schema.secrets)
    .values({
      id: "s-crate",
      projectId: P,
      name: "GITHUB_TOKEN",
      ciphertext: encryptSecret("ghp_secret_value"),
      createdAt: now,
    })
    .run();
  db.insert(schema.taskTemplates)
    .values({
      id: "t-crate",
      projectId: P,
      name: "chain",
      steps: JSON.stringify([{ agentName: "front" }]),
      autoRunNext: true,
      createdAt: now,
    })
    .run();
}

const withSecrets = { ...DEFAULT_INCLUDE, secrets: true };
const project = (id: string) =>
  db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
const agentsOf = (id: string) =>
  db.select().from(schema.agents).where(eq(schema.agents.projectId, id)).all();

describe("a project leaves and comes back", () => {
  beforeEach(seedProject);

  it("the full round trip recreates the project next to the original", () => {
    const sealed = sealCrate(collectCrate(P, withSecrets), PASS, WORK);
    const { projectId, slug } = applyCrate(openCrate(sealed, PASS), "Atelier (copy)");

    assert.notEqual(projectId, P);
    assert.equal(slug, "atelier-copy");
    const copy = project(projectId);
    assert.equal(copy.name, "Atelier (copy)");
    assert.equal(copy.context, "the living context");
    assert.equal(copy.gitAuthorEmail, "bot@example.test");
    // The original has not moved: import always creates a new project.
    assert.equal(project(P).name, "Atelier");
    assert.equal(agentsOf(P).length, 1);
  });

  it("links are rebuilt by name, with new ids", () => {
    const sealed = sealCrate(collectCrate(P, withSecrets), PASS, WORK);
    const { projectId } = applyCrate(openCrate(sealed, PASS));
    const copy = agentsOf(projectId)[0]!;
    const newRule = db
      .select()
      .from(schema.rules)
      .where(eq(schema.rules.projectId, projectId))
      .get()!;
    const newMcp = db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.projectId, projectId))
      .get()!;

    assert.notEqual(newRule.id, RULE);
    assert.notEqual(newMcp.id, MCP);
    assert.deepEqual(JSON.parse(copy.ruleIds), [newRule.id]);
    assert.deepEqual(JSON.parse(copy.mcpServerIds), [newMcp.id]);
    // Chain bindings: role → name in transit, role → id on arrival.
    assert.deepEqual(JSON.parse(project(projectId).chainBindings), { spec: copy.id });
  });

  it("the environment follows the agent, and so does the network policy", () => {
    // The most important test here. Without it an imported `limited` agent came back `open`,
    // unnoticed until the first session went out to the network.
    const sealed = sealCrate(collectCrate(P, withSecrets), PASS, WORK);
    const { projectId } = applyCrate(openCrate(sealed, PASS));
    const copy = agentsOf(projectId)[0]!;
    const env = db
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, copy.environmentId!))
      .get()!;
    assert.equal(env.projectId, projectId);
    assert.equal(env.networking, "limited");
    assert.deepEqual(JSON.parse(env.allowedHosts), ["api.github.com"]);
  });

  it("the secret leaves the crate in clear and is re-encrypted under the local key", () => {
    const sealed = sealCrate(collectCrate(P, withSecrets), PASS, WORK);
    const { projectId } = applyCrate(openCrate(sealed, PASS));
    const s = db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.projectId, projectId))
      .get()!;
    assert.equal(s.name, "GITHUB_TOKEN");
    assert.equal(decryptSecret(s.ciphertext), "ghp_secret_value");
    // Re-encrypted, so different from the original: the crate does not copy a ciphertext another
    // master key could not open.
    const original = db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.id, "s-crate"))
      .get()!;
    assert.notEqual(s.ciphertext, original.ciphertext);
  });

  it("the original machine's working folder does not travel", () => {
    const sealed = sealCrate(collectCrate(P, withSecrets), PASS, WORK);
    assert.equal(sealed.includes("elsewhere"), false); // encrypted anyway, but above all absent
    const { projectId } = applyCrate(openCrate(sealed, PASS));
    assert.equal(project(projectId).fsRoot, null);
  });
});

describe("what is unchecked does not leave", () => {
  beforeEach(seedProject);

  it("without secrets, the crate carries none", () => {
    const payload = collectCrate(P, DEFAULT_INCLUDE); // secrets: false by default
    assert.equal(payload.secrets.length, 0);
    assert.equal(JSON.stringify(payload).includes("ghp_secret_value"), false);
    const { projectId } = applyCrate(payload);
    assert.equal(
      db.select().from(schema.secrets).where(eq(schema.secrets.projectId, projectId)).all().length,
      0,
    );
  });

  it("without rules, the agent loses the grant instead of keeping a ghost id", () => {
    const payload = collectCrate(P, { ...DEFAULT_INCLUDE, rules: false });
    assert.deepEqual(payload.agents[0]!.ruleNames, []);
    const { projectId } = applyCrate(payload);
    assert.deepEqual(JSON.parse(agentsOf(projectId)[0]!.ruleIds), []);
  });

  it("without agents, there is neither agent nor environment on the other side", () => {
    const { projectId } = applyCrate(collectCrate(P, { ...DEFAULT_INCLUDE, agents: false }));
    assert.equal(agentsOf(projectId).length, 0);
    assert.equal(
      db
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.projectId, projectId))
        .all().length,
      0,
    );
  });
});

describe("the preview, which writes nothing", () => {
  beforeEach(seedProject);

  it("counts what would be created without touching the database", () => {
    const before = db.select().from(schema.projects).all().length;
    const s = summarizeCrate(collectCrate(P, withSecrets));
    assert.equal(s.project, "Atelier");
    assert.deepEqual(s.counts, {
      environments: 1,
      agents: 1,
      repos: 1,
      rules: 1,
      mcpServers: 1,
      templates: 1,
      secrets: 1,
    });
    assert.equal(db.select().from(schema.projects).all().length, before);
  });

  it("says skills travel by name only", () => {
    const notes = summarizeCrate(collectCrate(P, withSecrets)).notes.join(" ");
    assert.match(notes, /skill/i);
    assert.match(notes, /re-encrypted/);
  });

  it("refuses content that does not have a crate's shape", () => {
    assert.throws(() => summarizeCrate({ hello: true }), /does not have the expected shape/);
    assert.throws(() => summarizeCrate(null), /does not have the expected shape/);
  });

  it("refuses a crate written by a newer version", () => {
    const payload = { ...collectCrate(P, withSecrets), format: 99 };
    assert.throws(() => summarizeCrate(payload), /newer version/);
  });
});

describe("two imports of the same crate do not collide", () => {
  beforeEach(seedProject);

  it("the second project takes a free slug", () => {
    const payload = collectCrate(P, withSecrets);
    const a = applyCrate(payload, "Atelier again");
    const b = applyCrate(payload, "Atelier again");
    assert.equal(a.slug, "atelier-again");
    assert.equal(b.slug, "atelier-again-2");
    assert.notEqual(a.projectId, b.projectId);
  });
});

describe("the manifest, before any passphrase", () => {
  beforeEach(seedProject);

  it("gives real counts without decrypting anything", () => {
    const m = crateManifest(P);
    assert.equal(m.project, "Atelier");
    assert.equal(m.slug, "atelier");
    assert.deepEqual(m.counts, {
      agents: 1,
      repos: 1,
      mcpServers: 1,
      rules: 1,
      templates: 1,
      secrets: 1,
    });
  });

  it("an unknown project is reported not found", () => {
    assert.throws(() => crateManifest("does-not-exist"), /not found/);
  });
});
