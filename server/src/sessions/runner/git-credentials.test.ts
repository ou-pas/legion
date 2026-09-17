// The container's credential store: the only place a token touches git.
//
// Until 26/08 `setupRepos` built the host list then filtered it with
// `.filter((h) => h === "github.com")` (v29). A private GitLab repository was therefore
// UNCLONABLE even read-only, and preflight, applying the same constant, refused to launch an agent
// that had to push there.
//
// Lot 11: this test no longer reads the source, it calls the rule. `credentialStoreLines`
// (runner-payload/repos.mts) is pure and receives its environment as a parameter, so twelve
// SPELLING assertions on `configureGit`'s body became what the function RETURNS. A source guard
// stayed green through an equivalent rewrite that broke behaviour, and red through a harmless
// rename.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credentialFor } from "../../integrations/forge.js";
import { credentialStoreLines } from "../../../../runner-payload/repos.mjs";

/** A granted repository, reduced to what the rule reads. */
const repo = (url: string, credential?: { username: string; tokenEnv: string }) => ({
  name: url.split("/").pop() ?? "r",
  url,
  // `access` changes nothing here: the credential store is written BEFORE the clone, and read-only
  // needs a token as much as write does. That is the v29 failure in one sentence.
  access: "write" as const,
  ...(credential ? { credential } : {}),
});

const GITLAB = { username: "oauth2", tokenEnv: "GITLAB_TOKEN" };
const GITHUB = { username: "x-access-token", tokenEnv: "GITHUB_TOKEN" };

describe("the credential store is no longer reserved to one forge", () => {
  it("writes a line for a GitLab host: the v29 failure, reversed", () => {
    const lines = credentialStoreLines([repo("https://gitlab.com/a/b.git", GITLAB)], {
      GITLAB_TOKEN: "glpat-xyz",
    });
    assert.deepEqual([...lines.entries()], [["gitlab.com", "https://oauth2:glpat-xyz@gitlab.com"]]);
  });

  it("serves several forges at once, one line per host", () => {
    const lines = credentialStoreLines(
      [
        repo("https://github.com/a/b.git", GITHUB),
        repo("https://gitlab.com/c/d.git", GITLAB),
        repo("https://framagit.org/e/f.git", GITLAB),
      ],
      { GITHUB_TOKEN: "ghp-1", GITLAB_TOKEN: "glpat-2" },
    );
    assert.deepEqual([...lines.keys()], ["github.com", "gitlab.com", "framagit.org"]);
    // A self-hosted GitLab instance receives the token the spec names, without any list of known
    // hosts: the 08/09 fix (framagit.org).
    assert.equal(lines.get("framagit.org"), "https://oauth2:glpat-2@framagit.org");
  });

  it("the credential comes from the SPEC: user name and variable name, not a constant", () => {
    const lines = credentialStoreLines(
      [repo("https://forge.internal/a/b.git", { username: "robot", tokenEnv: "FORGE_PAT" })],
      { FORGE_PAT: "s3cr3t", GITHUB_TOKEN: "ghp-never-here" },
    );
    assert.equal(lines.get("forge.internal"), "https://robot:s3cr3t@forge.internal");
  });
});

describe("the fallback for old specs stays PINNED to github.com", () => {
  // The backward-compat branch (a spec without `credential`) dates from when a token was only ever
  // presented to github.com. Reusing `GITHUB_TOKEN` for any host would send a GitHub PAT to
  // bitbucket.org, the exact regression removing the filter nearly introduced.
  // a failli introduire.
  it("github.com without credential falls back to GITHUB_TOKEN, then GIT_TOKEN", () => {
    assert.equal(
      credentialStoreLines([repo("https://github.com/a/b.git")], { GITHUB_TOKEN: "ghp-1" }).get(
        "github.com",
      ),
      "https://x-access-token:ghp-1@github.com",
    );
    assert.equal(
      credentialStoreLines([repo("https://github.com/a/b.git")], { GIT_TOKEN: "ghp-2" }).get(
        "github.com",
      ),
      "https://x-access-token:ghp-2@github.com",
    );
  });

  it("ANOTHER host without credential gets NOTHING, even if GITHUB_TOKEN is there", () => {
    const lines = credentialStoreLines([repo("https://bitbucket.org/a/b.git")], {
      GITHUB_TOKEN: "ghp-1",
      GIT_TOKEN: "ghp-2",
    });
    assert.equal(lines.size, 0);
  });
});

describe("what gets no line", () => {
  it("a repository whose secret is not in the environment: the clone will say so plainly", () => {
    // `credential` is missing or its secret was not granted. The repository is then cloned WITHOUT a
    // token: public it passes, private it fails saying so.
    assert.equal(credentialStoreLines([repo("https://gitlab.com/a/b.git", GITLAB)], {}).size, 0);
  });

  it("a non-https URL: ssh and local paths do not go through the credential store", () => {
    assert.equal(
      credentialStoreLines([repo("git@github.com:a/b.git", GITHUB)], { GITHUB_TOKEN: "x" }).size,
      0,
    );
    assert.equal(
      credentialStoreLines([repo("/tmp/local/repo", GITHUB)], { GITHUB_TOKEN: "x" }).size,
      0,
    );
  });

  it("an unreadable URL is ignored instead of failing the whole credential store", () => {
    const lines = credentialStoreLines(
      [repo("https://"), repo("https://github.com/a/b.git", GITHUB)],
      { GITHUB_TOKEN: "ghp-1" },
    );
    assert.deepEqual([...lines.keys()], ["github.com"]);
  });
});

describe("one token per host, never two competing lines", () => {
  it("the host's FIRST repository wins: git credential store reads the first matching line", () => {
    // Two lines for the same host would give a silent choice depending on repository order. The
    // rule decides explicitly.
    const lines = credentialStoreLines(
      [
        repo("https://gitlab.com/a/b.git", { username: "first", tokenEnv: "T1" }),
        repo("https://gitlab.com/c/d.git", { username: "second", tokenEnv: "T2" }),
      ],
      { T1: "one", T2: "two" },
    );
    assert.equal(lines.size, 1);
    assert.equal(lines.get("gitlab.com"), "https://first:one@gitlab.com");
  });
});

describe("the token and user name are ENCODED in the URL", () => {
  it("a reserved character does not break the line", () => {
    // A group token can contain `-` and `_`, but nothing stops a forge from issuing a character that
    // would break the URL. Encoding costs nothing and removes the question.
    const lines = credentialStoreLines(
      [repo("https://forge.internal/a/b.git", { username: "a@b/c", tokenEnv: "T" })],
      { T: "tok:en/+=" },
    );
    assert.equal(lines.get("forge.internal"), "https://a%40b%2Fc:tok%3Aen%2F%2B%3D@forge.internal");
  });
});

describe("the clone failure message names the RIGHT secret", () => {
  it("both secret names in the table exist on the server side", () => {
    // The link between the two halves: the runner reads `process.env[tokenEnv]`, and `tokenEnv` comes
    // from this table. If it changed without the secrets channel following, the clone would fail
    // with nothing saying why.
    assert.equal(credentialFor("github").secretName, "GITHUB_TOKEN");
    assert.equal(credentialFor("gitlab").secretName, "GITLAB_TOKEN");
  });
});
