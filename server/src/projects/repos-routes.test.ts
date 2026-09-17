// A repository's two transports (02/09): `https://` with its forge (the token from the secret
// store), and SSH (`git@host:path`, `ssh://…`) covered by the project key, where the forge can be
// declared later since it only serves change requests. The runtime handled both since v40, but this
// route refused anything not https (seen on 02/09 connecting Kopee.me's framagit repositories).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-repos-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
// No allowlist (08/09): this route no longer reads `LEGION_FORGE_HOSTS`. Typing a URL and picking
// its forge in the menu is the authorisation. See the header of repo-url.ts.
delete process.env.LEGION_FORGE_HOSTS;
after(() => rmSync(dir, { recursive: true, force: true }));

// Secrets are encrypted, and both discovery and adoption go through them.
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../shared/db.js");
const { encryptSecret } = await import("../shared/crypto.js");
const { FORGE_DISCOVERY_CAP, registerForge } = await import("../integrations/forge.js");
const { gitlabForge } = await import("../integrations/gitlab.js");
const { registerRepoRoutes } = await import("./repos-routes.js");

const app = new Hono();
registerRepoRoutes(app);

const PROJECT = "prj-repos";

before(() => {
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "Kopee", slug: "kopee", createdAt: new Date() })
    .run();
});

const post = (body: unknown) =>
  app.request("/api/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/repos: https and SSH, both declarable", () => {
  it("https with the forge guessed from the host: created", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "web",
      url: "https://github.com/org/web.git",
    });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { forge: string }).forge, "github");
  });

  it("https on an unknown host without a declared forge: refused, with a message", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "api-https",
      url: "https://framagit.org/org/api.git",
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /unknown forge/);
  });

  it("https on an unknown host with a declared forge: created", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "api2",
      url: "https://framagit.org/org/api.git",
      forge: "gitlab",
    });
    assert.equal(res.status, 201);
  });

  it("SSH scp form (git@host:path) without forge: created, forge to declare later", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "front",
      url: "git@framagit.org:org/front.git",
    });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { forge: string | null }).forge, null);
  });

  it("SSH ssh:// form: created", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "infra",
      url: "ssh://git@framagit.org/org/infra.git",
    });
    assert.equal(res.status, 201);
  });

  it("an https URL carrying credentials stays refused: the token goes through the secret store", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "fuite",
      url: "https://user:ghp_x@github.com/org/x.git",
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /credential/);
  });

  it("neither https nor SSH: refused, naming both expected forms", async () => {
    const res = await post({ projectId: PROJECT, name: "ftp", url: "ftp://x/y.git" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /https:\/\/ or SSH/);
  });

  it("a self-hosted instance is accepted once its forge is declared", async () => {
    // The 08/09 reversal: here the operator names the host and the token in one form. Asking again
    // for a server file entry added a restart and no information, and killed the clone on framagit.org.
    const res = await post({
      projectId: PROJECT,
      name: "interne",
      url: "https://git.perso.example/org/x.git",
      forge: "gitlab",
    });
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  });

  it("and the SSH form passes too, the project key standing in for credentials", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "internal-ssh",
      url: "git@git.perso.example:org/x.git",
    });
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  });
});

// ---- The list to pick from, and the identity that fills itself (16/09) ----
//
// A fake adapter registered as `github`, not a real call: this tests composition (the connection
// opens the list, adding adopts the identity), not GitHub API translation (`github.test.ts`). The
// registry is a plain Map, and each test file runs in its own process.
const CANDIDATES = [
  {
    fullName: "ou-pas/front",
    url: "https://github.com/ou-pas/front.git",
    private: false,
  },
  {
    fullName: "ou-pas/back",
    url: "https://github.com/ou-pas/back.git",
    private: true,
  },
];

/** What the fake forge answers, adjustable per test. */
const fake = {
  repos: CANDIDATES as typeof CANDIDATES | null,
  login: "ou-pas" as string | null,
  emails: [
    { email: "romuald@example.com", primary: true },
    { email: "46607170+ou-pas@users.noreply.github.com", primary: false },
  ] as { email: string; primary: boolean }[] | null,
  /** A forge that throws, not just one that stays silent: two distinct failures, and adoption must
   *  survive both without undoing the repository add. */
  throwOnEmails: false,
};

const notCalled = () => {
  throw new Error("this call has no business in these tests");
};

registerForge({
  kind: "github",
  changeRequestLabel: "pull request",
  projectPath: () => null,
  compareBranch: notCalled,
  listOpen: notCalled,
  mergeState: notCalled,
  mergeStateWithPrState: notCalled,
  checks: notCalled,
  checkLog: notCalled,
  createRepoHook: notCalled,
  listMergedTitles: notCalled,
  create: notCalled,
  assignChangeRequest: notCalled,
  getTokenOwnerLogin: async () => fake.login,
  listVerifiedEmails: async () => {
    if (fake.throwOnEmails) throw new Error("the forge is down");
    return fake.emails;
  },
  listRepos: async () => fake.repos,
});

const CONNECTED = "prj-connected";

function connectedProject(id: string): void {
  db.insert(schema.projects).values({ id, name: id, slug: id, createdAt: new Date() }).run();
  db.insert(schema.secrets)
    .values({
      id: `s-${id}`,
      projectId: id,
      name: "GITHUB_TOKEN",
      ciphertext: encryptSecret("gh-token"),
      createdAt: new Date(),
    })
    .run();
}

const available = (projectId: string) => app.request(`/api/repos/available?projectId=${projectId}`);

describe("GET /api/repos/available: list instead of making people type", () => {
  before(() => connectedProject(CONNECTED));

  it("without projectId: refused, naming it", async () => {
    const res = await app.request("/api/repos/available");
    assert.equal(res.status, 400);
  });

  it("no connection: a named empty list, not an error", async () => {
    const res = await available(PROJECT);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { connected: string[]; repos: unknown[] };
    assert.deepEqual(body.connected, []);
    assert.deepEqual(body.repos, []);
  });

  it("one connection: reachable repositories, with their forge", async () => {
    const body = (await (await available(CONNECTED)).json()) as {
      connected: string[];
      repos: { fullName: string; forge: string; declared: boolean }[];
      truncated: boolean;
    };
    assert.deepEqual(body.connected, ["github"]);
    assert.equal(body.repos.length, 2);
    assert.equal(body.repos[0]?.forge, "github");
    assert.equal(body.truncated, false);
  });

  it("a repository already declared is marked: not offered twice", async () => {
    db.insert(schema.repos)
      .values({
        id: "r-already",
        projectId: CONNECTED,
        name: "front",
        url: "https://github.com/ou-pas/front.git",
        forge: "github",
        createdAt: new Date(),
      })
      .run();
    const body = (await (await available(CONNECTED)).json()) as {
      repos: { fullName: string; declared: boolean }[];
    };
    assert.equal(body.repos.find((r) => r.fullName === "ou-pas/front")?.declared, true);
    assert.equal(body.repos.find((r) => r.fullName === "ou-pas/back")?.declared, false);
  });

  it("a silent forge becomes a named error, not an empty list", async () => {
    fake.repos = null;
    const body = (await (await available(CONNECTED)).json()) as {
      repos: unknown[];
      errors: { forge: string; error: string }[];
    };
    fake.repos = CANDIDATES;
    assert.deepEqual(body.repos, []);
    assert.equal(body.errors[0]?.forge, "github");
    assert.match(body.errors[0]?.error ?? "", /did not return the repo list/);
  });
});

describe("POST /api/repos: the git identity fills in when the repository enters", () => {
  const identityOf = (id: string) =>
    db
      .select({ name: schema.projects.gitAuthorName, email: schema.projects.gitAuthorEmail })
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

  it("default identity: the noreply is adopted, and the UI learns it from the response", async () => {
    const id = "prj-adopted";
    connectedProject(id);
    const res = await post({
      projectId: id,
      name: "back",
      url: "https://github.com/ou-pas/back.git",
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { gitIdentityAdopted: { name: string; email: string } };
    assert.deepEqual(body.gitIdentityAdopted, {
      name: "ou-pas",
      email: "46607170+ou-pas@users.noreply.github.com",
    });
    assert.deepEqual(identityOf(id), {
      name: "ou-pas",
      email: "46607170+ou-pas@users.noreply.github.com",
    });
  });

  it("identity already chosen: left alone", async () => {
    const id = "prj-chosen";
    connectedProject(id);
    db.update(schema.projects)
      .set({ gitAuthorName: "Acme Agent", gitAuthorEmail: "agents@acme.test" })
      .where(eq(schema.projects.id, id))
      .run();
    const res = await post({
      projectId: id,
      name: "back",
      url: "https://github.com/ou-pas/back.git",
    });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { gitIdentityAdopted: null }).gitIdentityAdopted, null);
    assert.deepEqual(identityOf(id), { name: "Acme Agent", email: "agents@acme.test" });
  });

  it("a silent forge does not prevent the add: the repository enters, the identity does not move", async () => {
    const id = "prj-silent";
    connectedProject(id);
    fake.emails = null;
    const res = await post({
      projectId: id,
      name: "back",
      url: "https://github.com/ou-pas/back.git",
    });
    fake.emails = [
      { email: "romuald@example.com", primary: true },
      { email: "46607170+ou-pas@users.noreply.github.com", primary: false },
    ];
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { gitIdentityAdopted: null }).gitIdentityAdopted, null);
    assert.deepEqual(identityOf(id), { name: null, email: null });
  });

  it("a throwing forge does not prevent the add either", async () => {
    const id = "prj-failing";
    connectedProject(id);
    fake.throwOnEmails = true;
    const res = await post({
      projectId: id,
      name: "back",
      url: "https://github.com/ou-pas/back.git",
    });
    fake.throwOnEmails = false;
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { gitIdentityAdopted: null }).gitIdentityAdopted, null);
    assert.deepEqual(identityOf(id), { name: null, email: null });
  });

  it("no connection: the add works, adoption stays silent", async () => {
    const res = await post({
      projectId: PROJECT,
      name: "no-connection",
      url: "https://github.com/org/none.git",
    });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { gitIdentityAdopted: null }).gitIdentityAdopted, null);
  });
});

describe("truncation is judged per forge: a total is not a truncation", () => {
  const many = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({
      fullName: `${prefix}/r${i}`,
      url: `https://github.com/${prefix}/r${i}.git`,
      private: false,
    }));

  it("one forge at the cap: truncated, and the UI must say so", async () => {
    fake.repos = many(FORGE_DISCOVERY_CAP, "ou-pas");
    const body = (await (await available(CONNECTED)).json()) as { truncated: boolean };
    fake.repos = CANDIDATES;
    assert.equal(body.truncated, true);
  });

  it("two forges at half the cap: not truncated, neither was cut", async () => {
    // The fake GitLab exists only for this test, the only one needing two forges: exactly the false
    // positive that judging on the total produced.
    registerForge({
      ...gitlabForge,
      listRepos: async () => many(FORGE_DISCOVERY_CAP / 2, "kopee"),
    });
    db.insert(schema.secrets)
      .values({
        id: `s-${CONNECTED}-gl`,
        projectId: CONNECTED,
        name: "GITLAB_TOKEN",
        ciphertext: encryptSecret("gl-token"),
        createdAt: new Date(),
      })
      .run();
    fake.repos = many(FORGE_DISCOVERY_CAP / 2, "ou-pas");
    const body = (await (await available(CONNECTED)).json()) as {
      truncated: boolean;
      repos: unknown[];
    };
    fake.repos = CANDIDATES;
    assert.equal(body.repos.length, FORGE_DISCOVERY_CAP);
    assert.equal(body.truncated, false);
  });
});

describe("adoption queries the connection of the entering repository's forge", () => {
  it("a GitLab repository does not set the GitHub account's identity", async () => {
    const id = "prj-bi-forge";
    connectedProject(id);
    // The fake GitLab answers something different from the fake GitHub: the only way to see which
    // connection was queried. Without it, `find(kind === forge) ?? connections[0]` gave the same
    // result both ways.
    registerForge({
      ...gitlabForge,
      getTokenOwnerLogin: async () => "gitlab-account",
      listVerifiedEmails: async () => [{ email: "me@framagit.test", primary: true }],
    });
    db.insert(schema.secrets)
      .values({
        id: `s-${id}-gl`,
        projectId: id,
        name: "GITLAB_TOKEN",
        ciphertext: encryptSecret("gl-token"),
        createdAt: new Date(),
      })
      .run();
    const res = await post({
      projectId: id,
      name: "api",
      url: "https://gitlab.com/kopee/back/api.git",
    });
    assert.equal(res.status, 201);
    assert.deepEqual(((await res.json()) as { gitIdentityAdopted: unknown }).gitIdentityAdopted, {
      name: "gitlab-account",
      email: "me@framagit.test",
    });
  });

  it("and a GitHub repository on the same project takes the other connection", async () => {
    const id = "prj-bi-forge-2";
    connectedProject(id);
    db.insert(schema.secrets)
      .values({
        id: `s-${id}-gl`,
        projectId: id,
        name: "GITLAB_TOKEN",
        ciphertext: encryptSecret("gl-token"),
        createdAt: new Date(),
      })
      .run();
    const res = await post({
      projectId: id,
      name: "front",
      url: "https://github.com/ou-pas/front.git",
    });
    assert.equal(res.status, 201);
    assert.deepEqual(((await res.json()) as { gitIdentityAdopted: unknown }).gitIdentityAdopted, {
      name: "ou-pas",
      email: "46607170+ou-pas@users.noreply.github.com",
    });
  });
});
