// A launch check refusing wrongly is WORSE than no check: it blocks legitimate work and ends up
// disabled. Every test here is about the line between "certain" and "maybe", where this file earns
// or loses its value.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockerMessage, hostAllowed, networkBlockers, repoBlockers } from "./preflight.js";
import { REPO_ACCESS } from "../shared/enums.js";

const GH = { name: "legion", url: "https://github.com/ou-pas/legion.git" };
const base = {
  agentName: "server",
  repoAccess: REPO_ACCESS.write,
  grantedRepos: [GH],
  grantedSecretNames: [] as string[],
  projectSecretNames: [] as string[],
  sshKey: null as { path: string; problem: string | null } | null,
};

const CLE_OK = { path: "/Users/operator/.ssh/id_acme", problem: null };
const SSH_REPO = { name: "backend", url: "git@github.com:AcmeHQ/backend.git" };

describe("repoBlockers", () => {
  it("refuses a push without GITHUB_TOKEN: impossible, public or private", () => {
    const b = repoBlockers(base);
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /missing from the project secrets/);
  });

  it('tells "to create" from "to tick": the two gestures are in different places', () => {
    const b = repoBlockers({ ...base, projectSecretNames: ["GITHUB_TOKEN"] });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /is not granted to “server”/);
    assert.match(b[0]!.reason, /Agents → server → Secrets/);
  });

  it("lets through when the secret is granted", () => {
    assert.deepEqual(
      repoBlockers({
        ...base,
        grantedSecretNames: ["GITHUB_TOKEN"],
        projectSecretNames: ["GITHUB_TOKEN"],
      }),
      [],
    );
  });

  it("does NOT refuse a read without a token: the repo may be public", () => {
    // The false positive we refuse to commit. A public repo clones with nothing; if private, the clone
    // fails plainly, rather than this check guessing.
    assert.deepEqual(repoBlockers({ ...base, repoAccess: REPO_ACCESS.read }), []);
  });

  // v40: SSH became legitimate, but only when a key exists. The refusal does not disappear, it moves:
  // from "no container will ever have a key" to "THIS project declares none". These four tests hold
  // that line.
  it("refuses an SSH URL when the project declares no key", () => {
    const b = repoBlockers({
      ...base,
      repoAccess: REPO_ACCESS.read,
      grantedRepos: [{ name: "legion", url: "git@github-legion:ou-pas/legion.git" }],
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /no key/);
  });

  it("accepts an SSH URL with a key, EVEN for writes, without any token", () => {
    // The key IS the credential: demanding GITHUB_TOKEN as well would be an imaginary refusal.
    assert.deepEqual(repoBlockers({ ...base, grantedRepos: [SSH_REPO], sshKey: CLE_OK }), []);
  });

  it("an unusable key blocks, SAYING which one and why", () => {
    const b = repoBlockers({
      ...base,
      grantedRepos: [SSH_REPO],
      sshKey: { path: "/k", problem: "/k is protected by a passphrase" },
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /passphrase/);
  });

  it("a URL neither https nor SSH is still refused", () => {
    const b = repoBlockers({
      ...base,
      grantedRepos: [{ name: "x", url: "ftp://example.com/x.git" }],
      sshKey: CLE_OK,
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /neither https nor SSH/);
  });

  // v29: the forge decides the secret. This check used to compare the host with `github.com` and
  // refuse everything else, advising to host the repo on GitHub. A writable GitLab repository never
  // started, whatever the configuration. The right question was never "is it github.com?" but
  // "can we present a credential to this forge, and was it granted to this agent?".
  it("a GitLab repo requires GITLAB_TOKEN, not GITHUB_TOKEN", () => {
    const b = repoBlockers({
      ...base,
      grantedRepos: [{ name: "api", url: "https://gitlab.com/kopee/api.git", forge: "gitlab" }],
      grantedSecretNames: ["GITHUB_TOKEN"],
      projectSecretNames: ["GITHUB_TOKEN"],
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /GITLAB_TOKEN/);
    // The message also names the host, which avoids checking the wrong setting.
    assert.match(b[0]!.reason, /gitlab\.com/);
  });

  it("lets through a GitLab repo whose token is granted", () => {
    assert.deepEqual(
      repoBlockers({
        ...base,
        grantedRepos: [{ name: "api", url: "https://gitlab.com/kopee/api.git", forge: "gitlab" }],
        grantedSecretNames: ["GITLAB_TOKEN"],
        projectSecretNames: ["GITLAB_TOKEN"],
      }),
      [],
      "a correctly configured GitLab repository must start: impossible before v29",
    );
  });

  it("a MIXED project names the right secret FOR EACH repo", () => {
    // The case that makes the table useful: two forges in one project, one secret granted.
    const b = repoBlockers({
      ...base,
      grantedRepos: [GH, { name: "api", url: "https://gitlab.com/kopee/api.git", forge: "gitlab" }],
      grantedSecretNames: ["GITHUB_TOKEN"],
      projectSecretNames: ["GITHUB_TOKEN"],
    });
    assert.equal(b.length, 1, "only the GitLab repo blocks");
    assert.equal(b[0]!.repo, "api");
    assert.match(b[0]!.reason, /GITLAB_TOKEN/);
  });

  it("a SELF-HOSTED instance goes through its declared forge, never its host name", () => {
    // The reason for the `forge` column: `git.kopee.me` does not contain "gitlab". Guessing from the
    // host would have presented the wrong credential, and the failure would have come at clone time,
    // in the container, blaming an ungranted secret.
    assert.deepEqual(
      repoBlockers({
        ...base,
        grantedRepos: [
          { name: "internal", url: "https://git.kopee.me/infra/ansible.git", forge: "gitlab" },
        ],
        grantedSecretNames: ["GITLAB_TOKEN"],
        projectSecretNames: ["GITLAB_TOKEN"],
      }),
      [],
    );
  });

  it("a repo without declared forge on github.com stays GitHub: rows from before v34", () => {
    const b = repoBlockers({
      ...base,
      grantedRepos: [{ name: "old", url: "https://github.com/x/y.git" }],
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /GITHUB_TOKEN/);
  });

  it("a repo without forge on a THIRD-PARTY host is REFUSED, not treated as GitHub", () => {
    // The refusal the check had lost along the way. Before v29 it was about the host (the runner only
    // presented credentials to github.com); replacing it with the forge without handling "unknown"
    // forge would have let a Bitbucket repo start, and the container would have presented the GitHub
    // PAT to it. The question changed, the guarantee did not.
    const b = repoBlockers({
      ...base,
      grantedRepos: [{ name: "vendor", url: "https://bitbucket.org/acme/lib.git" }],
      grantedSecretNames: ["GITHUB_TOKEN"],
      projectSecretNames: ["GITHUB_TOKEN"],
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /unknown forge/);
    assert.match(b[0]!.reason, /bitbucket\.org/);
  });

  it("says nothing when the agent has no repo access", () => {
    assert.deepEqual(repoBlockers({ ...base, repoAccess: REPO_ACCESS.none }), []);
  });

  it("says nothing when no repo is granted, even for writes", () => {
    assert.deepEqual(repoBlockers({ ...base, grantedRepos: [] }), []);
  });

  it("reports EACH faulty repo, not only the first", () => {
    const b = repoBlockers({
      ...base,
      grantedRepos: [GH, { name: "old", url: "git@github.com:ou-pas/old.git" }],
    });
    assert.equal(b.length, 2);
    assert.deepEqual(
      b.map((x) => x.repo),
      ["legion", "old"],
    );
  });

  it('the message names the repo: "the clone failed" does not say which', () => {
    const msg = blockerMessage(repoBlockers(base));
    assert.match(msg, /repo “legion”/);
  });
});

// The wall (25/08). With a limited environment, a granted repo can be unreachable. This check is
// certain: the host is in the URL, the allowlist in the database, and the proxy compares exactly
// those two strings. They still have to be compared THE WAY IT DOES.
describe("hostAllowed: the same comparison as tinyproxy, not an approximation", () => {
  it("a named host passes, another does not", () => {
    assert.equal(hostAllowed("github.com", ["github.com"]), true);
    assert.equal(hostAllowed("evil.example", ["github.com"]), false);
  });

  it("the wildcard covers subdomains and NOTHING more", () => {
    assert.equal(hostAllowed("api.github.com", ["*.github.com"]), true);
    // fnmatch: "*.github.com" does not cover "github.com", the classic trap, and a preflight
    // ignoring it would let through a launch the proxy will refuse.
    assert.equal(hostAllowed("github.com", ["*.github.com"]), false);
    assert.equal(hostAllowed("github.com.evil.example", ["*.github.com"]), false);
  });

  it('a dot is not a regex wildcard: "githubxcom" does not pass for "github.com"', () => {
    assert.equal(hostAllowed("githubxcom", ["github.com"]), false);
  });

  it("case and surrounding spaces change nothing", () => {
    assert.equal(hostAllowed("GitHub.com", [" github.com "]), true);
  });
});

describe("networkBlockers", () => {
  const repos = [GH];

  it("an open environment blocks nothing", () => {
    assert.deepEqual(
      networkBlockers({ agentName: "server", network: { mode: "open" }, grantedRepos: repos }),
      [],
    );
  });

  // v40: the hole through which an SSH repo escaped the wall. `new URL("git@github.com:o/r.git")`
  // fails, and the `catch` was a `continue`: the check skipped it WITHOUT a word. Invisible while SSH
  // was refused above.
  it("an SSH repo is subject to the wall like the others", () => {
    const b = networkBlockers({
      agentName: "back",
      network: { mode: "limited", allowedHosts: ["registry.npmjs.org"] },
      grantedRepos: [{ name: "backend", url: "git@github.com:AcmeHQ/backend.git" }],
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /github\.com is not in the network allowlist/);
  });

  it("with an incomplete environment, the remedy is to ADD the host, and it is named", () => {
    const b = networkBlockers({
      agentName: "spec",
      network: { mode: "limited", allowedHosts: ["registry.npmjs.org"] },
      grantedRepos: repos,
    });
    assert.equal(b.length, 1);
    assert.match(b[0]!.reason, /github\.com is not in the network allowlist/);
    assert.match(b[0]!.reason, /Add github\.com/);
  });

  it("an allowed host does not block: the check only refuses what will be refused", () => {
    assert.deepEqual(
      networkBlockers({
        agentName: "spec",
        network: { mode: "limited", allowedHosts: ["github.com"] },
        grantedRepos: repos,
      }),
      [],
    );
  });

  it("an unreadable URL is not ITS business: the neighbouring check names it", () => {
    assert.deepEqual(
      networkBlockers({
        agentName: "spec",
        network: { mode: "limited", allowedHosts: [] },
        grantedRepos: [{ name: "broken", url: "not a url" }],
      }),
      [],
    );
  });
});
