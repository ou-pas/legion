// Resolution: the only place deciding whom a token is presented to.
//
// This file did not exist when the port was written, and the review of the night of 26/08 showed the
// false economy: backward compatibility (`forge = NULL`), the repository cap, demo mode and mock mode
// all went through here, none exercised. Two regressions slept here, invisible to 623 green tests.
//
// Real temporary SQLite, as in review.test.ts: this module is data resolution, and simulating it would
// prove nothing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-forge-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
// Master key: secrets are encrypted, which is precisely what this module goes through.
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
// No allowlist is set, which is the subject of the self-hosted test below: since 08/09
// `resolveForgeRepos` no longer reads `LEGION_FORGE_HOSTS`; the forge declared on the `repos` row is
// enough. See sessions/runner/forge-credential-scope.test.ts for what the guard cost.
delete process.env.LEGION_FORGE_HOSTS;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { encryptSecret } = await import("../shared/crypto.js");
const { registerForge } = await import("./forge.js");
const { githubForge } = await import("./github.js");
const { gitlabForge } = await import("./gitlab.js");
const {
  createChangeRequests,
  mergeStatesOf,
  resolveForgeConnections,
  resolveForgeRepos,

  discoverRepos,
  FORGE_REPO_CAP,
} = await import("./forge-access.js");

const PROJECT = "p-forge";

// `eq` imported dynamically to stay after setting LEGION_DB, like the rest of the file.
const { eq: eq_ } = await import("drizzle-orm");

// The project is created once: its slug is unique, and recreating it per test hit the constraint. Only
// repositories and secrets are reset, all these tests change.
db.insert(schema.projects)
  .values({
    id: PROJECT,
    name: "Forge",
    slug: "forge-test",
    defaultModel: "sonnet",
    createdAt: new Date(),
  })
  .run();

function reset(): void {
  db.delete(schema.repos).where(eq_(schema.repos.projectId, PROJECT)).run();
  db.delete(schema.secrets).where(eq_(schema.secrets.projectId, PROJECT)).run();
}

function addRepo(name: string, url: string, forge: string | null): void {
  db.insert(schema.repos)
    .values({ id: `r-${name}`, projectId: PROJECT, name, url, forge, createdAt: new Date() })
    .run();
}
function addSecret(name: string, metadata?: string): void {
  db.insert(schema.secrets)
    .values({
      id: `s-${name}`,
      projectId: PROJECT,
      name,
      ciphertext: encryptSecret("valeur"),
      ...(metadata === undefined ? {} : { metadata }),
      createdAt: new Date(),
    })
    .run();
}

describe("resolveForgeRepos: the forge decides the secret", () => {
  beforeEach(reset);

  it("a GitLab repository takes GITLAB_TOKEN, a GitHub repository GITHUB_TOKEN", () => {
    addRepo("front", "https://github.com/o/front.git", "github");
    addRepo("api", "https://gitlab.com/k/back/api.git", "gitlab");
    addSecret("GITHUB_TOKEN");
    addSecret("GITLAB_TOKEN");
    const { resolved, errors } = resolveForgeRepos(PROJECT);
    assert.deepEqual(errors, []);
    assert.deepEqual(resolved.map((r) => [r.repo.name, r.adapter.kind]).sort(), [
      ["api", "gitlab"],
      ["front", "github"],
    ]);
  });

  it("one forge's missing secret does not hide the other", () => {
    // The module's rule on a mixed project: the case that makes the table useful.
    addRepo("front", "https://github.com/o/front.git", "github");
    addRepo("api", "https://gitlab.com/k/back/api.git", "gitlab");
    addSecret("GITHUB_TOKEN");
    const { resolved, errors } = resolveForgeRepos(PROJECT);
    assert.deepEqual(
      resolved.map((r) => r.repo.name),
      ["front"],
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.repo, "api");
    assert.match(errors[0]!.error, /GITLAB_TOKEN/);
  });

  it("a repository without forge on github.com stays GitHub: rows from before v34", () => {
    addRepo("vieux", "https://github.com/o/vieux.git", null);
    addSecret("GITHUB_TOKEN");
    const { resolved, errors } = resolveForgeRepos(PROJECT);
    assert.deepEqual(errors, []);
    assert.equal(resolved[0]!.repo.forge, "github");
  });

  it("a repository without forge on a third-party host gets no token", () => {
    // The key test of this file. Reading "no forge" as github was right while GitHub was the only
    // possible forge (no Bitbucket repository could exist before v34). Keeping that default would have
    // presented the GitHub PAT to bitbucket.org, which the runner's `host === "github.com"` filter
    // forbade. The constant is gone; the guarantee is not.
    addRepo("vendor", "https://bitbucket.org/acme/lib.git", null);
    addSecret("GITHUB_TOKEN");
    const { resolved, errors } = resolveForgeRepos(PROJECT);
    assert.deepEqual(resolved, [], "no token goes to a host whose forge is undetermined");
    assert.match(errors[0]!.error, /no forge declared/);
  });

  it("a declared self-hosted GitLab resolves normally", () => {
    addRepo("infra", "https://git.kopee.me/ops/ansible.git", "gitlab");
    addSecret("GITLAB_TOKEN");
    const { resolved } = resolveForgeRepos(PROJECT);
    assert.equal(resolved[0]!.adapter.kind, "gitlab");
  });

  it("any host resolves once the row declares its forge", () => {
    // The 08/09 reversal. The guard set here on 05/09 also cut a self-hosted project's diffs, change
    // requests and webhooks, not just its clone. What the operator picked in the forge menu next to the
    // URL they typed is authoritative.
    addRepo("ailleurs", "https://git.perso.example/ops/x.git", "gitlab");
    addSecret("GITLAB_TOKEN");
    const { resolved, errors } = resolveForgeRepos(PROJECT);
    assert.deepEqual(errors, []);
    assert.equal(resolved[0]!.adapter.kind, "gitlab");
  });
});

describe("resolveForgeRepos: the cap", () => {
  beforeEach(() => {
    reset();
    addSecret("GITHUB_TOKEN");
    for (let i = 0; i < FORGE_REPO_CAP + 2; i++)
      addRepo(`r${i}`, `https://github.com/o/r${i}.git`, "github");
  });

  it("caps reads, and says how many it left out", () => {
    const { resolved, truncated } = resolveForgeRepos(PROJECT);
    assert.equal(resolved.length, FORGE_REPO_CAP);
    assert.equal(truncated, 2, "truncation is data, not silence");
  });

  it("does not cap when the caller says so: writes never had a cap", () => {
    // A run pushing to twelve repositories must open twelve change requests. Extending the read cap to
    // writes would have stopped opening two, silently.
    const { resolved, truncated } = resolveForgeRepos(PROJECT, undefined, Infinity);
    assert.equal(resolved.length, FORGE_REPO_CAP + 2);
    assert.equal(truncated, 0);
  });
});

describe("createChangeRequests", () => {
  beforeEach(reset);

  it("no repository targeted is decided on the database, before mock and any secret", () => {
    // The 502 with no reason came from here: mock returned first with `{prs: [], errors: []}`, so the
    // UI showed an empty failure. The named error is the only actionable information: was the branch
    // pushed?
    return createChangeRequests({
      projectId: PROJECT,
      repoNames: [],
      branch: "legion/t",
      title: "T",
      body: "B",
      mock: true,
    }).then((res) => {
      assert.deepEqual(res.prs, []);
      assert.equal(res.errors.length, 1);
      assert.match(res.errors[0]!, /no repo targeted/);
    });
  });

  it("mock makes a URL only for the project's real repositories", async () => {
    // It used to return a fake PR for any requested name, including a non-repository, and that URL then
    // went into `task.prUrls`.
    addRepo("front", "https://github.com/o/front.git", "github");
    const res = await createChangeRequests({
      projectId: PROJECT,
      repoNames: ["front", "nexistepas"],
      branch: "legion/t",
      title: "T",
      body: "B",
      mock: true,
    });
    assert.deepEqual(
      res.prs.map((p) => p.repo),
      ["front"],
    );
    assert.deepEqual(res.errors, []);
  });

  it("mock touches no secret", async () => {
    // An unreadable ciphertext surfaced "Invalid authentication tag length" to the route as a 500, on a
    // session that by definition needed no secret.
    addRepo("front", "https://github.com/o/front.git", "github");
    db.insert(schema.secrets)
      .values({
        id: "s-broken",
        projectId: PROJECT,
        name: "GITHUB_TOKEN",
        ciphertext: "abc",
        createdAt: new Date(),
      })
      .run();
    const res = await createChangeRequests({
      projectId: PROJECT,
      repoNames: ["front"],
      branch: "legion/t",
      title: "T",
      body: "B",
      mock: true,
    });
    assert.equal(res.prs.length, 1);
  });
});

describe("mergeStatesOf: merge state of one task's PRs, never a project sweep", () => {
  beforeEach(reset);
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns [] without resolving anything: no repository, no secret read", async () => {
    assert.deepEqual(await mergeStatesOf(PROJECT, []), []);
  });

  it("a URL without a recognisable number falls back to unknown, without resolving a forge", async () => {
    globalThis.fetch = (() => {
      throw new Error("must call nothing");
    }) as unknown as typeof fetch;
    const out = await mergeStatesOf(PROJECT, [
      { repo: "front", url: "https://github.com/mock/front/pull/0" },
    ]);
    assert.deepEqual(out, [
      {
        repo: "front",
        url: "https://github.com/mock/front/pull/0",
        number: null,
        mergeState: "unknown",
      },
    ]);
  });

  it("a repository without secret falls back to unknown, named elsewhere (resolveForgeRepos), never an exception", async () => {
    addRepo("front", "https://github.com/o/front.git", "github"); // no secret set
    const out = await mergeStatesOf(PROJECT, [
      { repo: "front", url: "https://github.com/o/front/pull/62" },
    ]);
    assert.deepEqual(out, [
      {
        repo: "front",
        url: "https://github.com/o/front/pull/62",
        number: 62,
        mergeState: "unknown",
      },
    ]);
  });

  it("queries the PR detail (not the list) on the resolved repository", async () => {
    addRepo("front", "https://github.com/o/front.git", "github");
    addSecret("GITHUB_TOKEN");
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.ok(String(input).endsWith("/repos/o/front/pulls/62"), String(input));
      return {
        status: 200,
        json: async () => ({ mergeable: false }),
        headers: { get: () => null },
      } as unknown as Response;
    }) as typeof fetch;
    const out = await mergeStatesOf(PROJECT, [
      { repo: "front", url: "https://github.com/o/front/pull/62" },
    ]);
    // `checkState: "unknown"`: the PR is open, so CI is probed; this fake response has no branch head,
    // so nothing is known. And nothing known is never written as passing.
    assert.deepEqual(out, [
      {
        repo: "front",
        url: "https://github.com/o/front/pull/62",
        number: 62,
        mergeState: "conflict",
        prState: "open",
        checkState: "unknown",
      },
    ]);
  });

  it("a closed PR does not probe CI: two more calls for an action that no longer exists", async () => {
    addRepo("front", "https://github.com/o/front.git", "github");
    addSecret("GITHUB_TOKEN");
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return {
        status: 200,
        json: async () => ({ mergeable: true, state: "closed" }),
        headers: { get: () => null },
      } as unknown as Response;
    }) as typeof fetch;
    const out = await mergeStatesOf(PROJECT, [
      { repo: "front", url: "https://github.com/o/front/pull/62" },
    ]);
    assert.equal(out[0]!.prState, "closed");
    assert.equal(out[0]!.checkState, undefined, "not probed, so absent: never an invented state");
    assert.equal(calls.length, 1, calls.join("\n"));
  });

  it("demo mode: returns fake PR states without secret or network", async () => {
    const before = process.env.LEGION_GITHUB_FAKE;
    process.env.LEGION_GITHUB_FAKE = "1";
    globalThis.fetch = (() => {
      throw new Error("demo mode must call nothing");
    }) as unknown as typeof fetch;
    try {
      addRepo("front", "https://github.com/mock/front.git", "github");
      const out = await mergeStatesOf(PROJECT, [
        { repo: "front", url: "https://github.com/mock/front/pull/7" },
      ]);
      assert.deepEqual(out, [
        {
          repo: "front",
          url: "https://github.com/mock/front/pull/7",
          number: 7,
          mergeState: "conflict",
          prState: "open",
          checkState: "failing",
        },
      ]);
    } finally {
      if (before === undefined) delete process.env.LEGION_GITHUB_FAKE;
      else process.env.LEGION_GITHUB_FAKE = before;
    }
  });
});

describe("resolveForgeConnections: the read starting from the token, not repositories", () => {
  beforeEach(reset);

  it("no connection: an empty list, not an error", () => {
    assert.deepEqual(resolveForgeConnections(PROJECT), []);
  });

  it("a secret without a repository is enough: the whole difference with resolveForgeRepos", () => {
    addSecret("GITHUB_TOKEN");
    const found = resolveForgeConnections(PROJECT);
    assert.deepEqual(
      found.map((c) => c.kind),
      ["github"],
    );
  });

  it("the instance comes from the connection: a framagit token is not queried on gitlab.com", () => {
    // The 16/09 defect: the host was read from a global variable, so someone typing
    // `https://framagit.org` in the tile saw an empty list under Repositories. The path is
    // `freshAuthorization`'s: a `metadata` fact read next to the token through the choke point.
    addSecret("GITLAB_TOKEN", JSON.stringify({ fields: { host: "https://framagit.org/" } }));
    assert.equal(resolveForgeConnections(PROJECT)[0]?.instanceHost, "framagit.org");
  });

  it("without a set field, the public host, never nothing", () => {
    addSecret("GITLAB_TOKEN");
    assert.equal(resolveForgeConnections(PROJECT)[0]?.instanceHost, "gitlab.com");
  });

  it("unreadable `metadata` does not break resolution", () => {
    addSecret("GITLAB_TOKEN", "{not json");
    assert.equal(resolveForgeConnections(PROJECT)[0]?.instanceHost, "gitlab.com");
  });
});

describe("discoverRepos: the discovery safety net, and it is wired", () => {
  beforeEach(reset);

  it("a forge that never answers returns control, and its failure names the host", async () => {
    // The main cap is per page, in the adapter. This one bounds what an adapter does not (here, a fake
    // that never returns). The test fails if the wiring goes: without it `discoverRepos` would never
    // return.
    addSecret("GITHUB_TOKEN");
    registerForge({ ...githubForge, listRepos: () => new Promise(() => {}) });
    try {
      const { repos, errors } = await discoverRepos(PROJECT, 10);
      assert.deepEqual(repos, []);
      assert.equal(errors[0]?.forge, "github");
      // The queried host is named, and the cap too: 10 ms × 3 pages.
      assert.match(errors[0]?.error ?? "", /^github\.com — reading the repos > 30 ms/);
    } finally {
      registerForge(githubForge);
    }
  });

  it("a slow forge does not prevent the other from returning its repositories", async () => {
    addSecret("GITHUB_TOKEN");
    addSecret("GITLAB_TOKEN");
    registerForge({ ...githubForge, listRepos: () => new Promise(() => {}) });
    registerForge({
      ...gitlabForge,
      listRepos: async () => [
        { fullName: "kopee/api", url: "https://framagit.org/kopee/api.git", private: true },
      ],
    });
    try {
      const { repos, errors } = await discoverRepos(PROJECT, 10);
      assert.deepEqual(
        repos.map((r) => r.fullName),
        ["kopee/api"],
      );
      assert.equal(errors.length, 1);
    } finally {
      registerForge(githubForge);
      registerForge(gitlabForge);
    }
  });
});
