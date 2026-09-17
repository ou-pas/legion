// The repository URL guard alone, without a database (06/09, audit wave 2; narrowed on 08/09).
//
// The property protected: every door through which a `repos` row enters goes through it. Each door's
// own tests live with its module; this judges the rule itself, including refusal order.
//
// The 08/09 split is the main subject. What holds for every input (a transport git can read, no
// credentials in the URL) stays in `assertRepoUrlAllowed`. The host allowlist now applies only to
// what was not typed in the UI, crate import (`assertImportedRepoUrlAllowed`). The halves are tested
// separately because that is where a regression would hide: an allowlist moving back into the shared
// function would break self-hosted clones again, as on 08/09.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { assertImportedRepoUrlAllowed, assertRepoUrlAllowed } from "./repo-url.js";
import { FORGE_HOSTS_VAR } from "../integrations/forge.js";

const previous = process.env[FORGE_HOSTS_VAR];
before(() => {
  process.env[FORGE_HOSTS_VAR] = "framagit.org, gitlab.local:8443";
});
after(() => {
  if (previous === undefined) delete process.env[FORGE_HOSTS_VAR];
  else process.env[FORGE_HOSTS_VAR] = previous;
});

const refusal = (url: string): string => {
  const verdict = assertRepoUrlAllowed(url);
  assert.equal(verdict.ok, false, `${url} should have been refused`);
  return verdict.ok ? "" : verdict.error;
};

const importRefusal = (url: string): string => {
  const verdict = assertImportedRepoUrlAllowed(url);
  assert.equal(verdict.ok, false, `${url} should have been refused at import`);
  return verdict.ok ? "" : verdict.error;
};

describe("assertRepoUrlAllowed: what holds for every input", () => {
  it("accepts both public forges, over https and SSH", () => {
    for (const url of [
      "https://github.com/org/web.git",
      "https://gitlab.com/group/subgroup/project.git",
      "git@github.com:org/web.git",
      "ssh://git@gitlab.com/org/web.git",
    ])
      assert.deepEqual(assertRepoUrlAllowed(url), { ok: true, url }, url);
  });

  it("cleans the URL and lets any host through: the forge is declared on the repository", () => {
    assert.deepEqual(assertRepoUrlAllowed("  https://framagit.org/org/api.git  "), {
      ok: true,
      url: "https://framagit.org/org/api.git",
    });
  });

  // The 08/09 fix. It says the opposite of what this file required the day before: `git.kopee.me` is
  // in no allowlist, the operator typed it and picked its forge in the menu. Also requiring a server
  // env variable, with a restart, made the clone die on "could not read Username", seen on
  // framagit.org on a project whose repositories and token had been correct for six days.
  it("does not require the host to be declared: creating a repository in the UI is the authorisation", () => {
    for (const url of [
      "https://git.kopee.me/infra/ansible.git",
      "git@git.kopee.me:infra/ansible.git",
      "https://code.example.org/x/y.git",
    ])
      assert.equal(assertRepoUrlAllowed(url).ok, true, url);
  });

  it("refuses what is neither https nor SSH, naming both expected forms", () => {
    // Order matters: "unreadable host" would be true for ftp:// and teach nothing.
    assert.match(refusal("ftp://x/y.git"), /https:\/\/ or SSH/);
    assert.match(refusal("http://github.com/org/x.git"), /https:\/\/ or SSH/);
    assert.match(refusal("   "), /repo url required/);
  });

  it("refuses a URL carrying credentials, even on an allowed forge", () => {
    // It went into `git clone` argv, and Node's "Command failed: …" copied it into the session
    // event, readable on screen.
    assert.match(refusal("https://user:ghp_x@github.com/org/x.git"), /credential/);
    // The `git@` of an SSH URL is the protocol, not a credential: it passes.
    assert.equal(assertRepoUrlAllowed("git@github.com:org/x.git").ok, true);
  });
});

// Crate import is the only input whose URL does not come from the UI: a file written on another
// machine. The allowlist keeps its meaning there.
describe("assertImportedRepoUrlAllowed: the only input still reading the allowlist", () => {
  it("accepts a declared host, port included, and returns it cleaned", () => {
    assert.deepEqual(assertImportedRepoUrlAllowed("  https://framagit.org/org/api.git  "), {
      ok: true,
      url: "https://framagit.org/org/api.git",
    });
    // The comparison is exact on what `hostOfRepoUrl` returns: an instance on a port is declared
    // with its port, or the allowlist would admit what was not written.
    assert.equal(assertImportedRepoUrlAllowed("https://gitlab.local:8443/org/x.git").ok, true);
    assert.equal(assertImportedRepoUrlAllowed("https://gitlab.local/org/x.git").ok, false);
  });

  it("refuses an unknown host, naming the host and the variable that would admit it", () => {
    const error = importRefusal("https://git.evil.example/org/x.git");
    assert.match(error, /git\.evil\.example/);
    assert.match(error, /LEGION_FORGE_HOSTS/);
  });

  it("and the SSH form does not escape: `new URL()` cannot read it, `hostOfRepoUrl` can", () => {
    assert.match(importRefusal("git@git.evil.example:org/x.git"), /LEGION_FORGE_HOSTS/);
  });

  it("also applies the shared refusals, before the host", () => {
    // Composition must not lose the shared half: `ftp://` on an unknown host must hear about the
    // transport first.
    assert.match(importRefusal("ftp://git.evil.example/x.git"), /https:\/\/ or SSH/);
  });
});
