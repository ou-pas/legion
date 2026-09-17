// The forge port: what must hold whatever forge is behind it.
//
// No network call: `forge.ts` is pure by construction (no database, secret or fetch), which makes it
// testable in milliseconds. Adapters are tested next door against their APIs.
//
// What these tests really protect is the credential table. It alone unlocks `git push` on a forge other
// than GitHub; the rest is convenience by comparison. A mistake here does not show on screen: it shows
// six minutes later in a container, as a refused clone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedForgeHosts,
  countDiffLines,
  credentialFor,
  effectiveForge,
  FORGE_HOSTS_VAR,
  forgeInstanceHost,
  GITLAB_HOST_VAR,
  withForgeTimeout,
  FORGE_KINDS,
  forgeFor,
  forgeHostRefusal,
  forgeOfUrl,
  hostOfRepoUrl,
  isForgeKind,
  isSshRepoUrl,
  numberOfChangeRequestUrl,
  pathOfRepoUrl,
} from "./forge.js";
import "./github.js";
import "./gitlab.js";

describe("the credential table: what decides whether a push passes", () => {
  it("each known forge has a username and a secret name", () => {
    for (const kind of FORGE_KINDS) {
      const c = credentialFor(kind);
      assert.ok(c.username.length > 0, `${kind} : nom d'utilisateur vide`);
      assert.ok(c.secretName.length > 0, `${kind} : nom de secret vide`);
    }
  });

  it("GitLab uses oauth2, GitHub x-access-token", () => {
    // The exact reason, since a vague justification backfires the day someone wants to change it: a
    // GitLab PAT authenticates with any username, but an OAuth2 token (from which group and project
    // tokens derive) requires literally `oauth2`. It is the only name working for all three, and a
    // multi-repository GitLab project relies precisely on the group token.
    assert.equal(credentialFor("gitlab").username, "oauth2");
    assert.equal(credentialFor("github").username, "x-access-token");
  });

  it("two forges never share a secret name", () => {
    // Otherwise least privilege collapses silently: granting the secret for a GitHub repository would
    // give access to the same project's GitLab.
    const names = FORGE_KINDS.map((k) => credentialFor(k).secretName);
    assert.equal(
      new Set(names).size,
      names.length,
      `noms de secrets en double : ${names.join(", ")}`,
    );
  });
});

describe("forgeOfUrl: a suggestion, never an authority", () => {
  it("recognises public hosts", () => {
    assert.equal(forgeOfUrl("https://github.com/ou-pas/legion.git"), "github");
    assert.equal(forgeOfUrl("https://gitlab.com/kopee/api.git"), "gitlab");
  });

  it("returns null on an unknown host rather than betting on GitHub", () => {
    // The useful half of this function. A self-hosted GitLab is called `git.kopee.me`: guessing github
    // would present the wrong credential, failing at clone in the container while blaming an ungranted
    // secret. The caller must ask the human.
    assert.equal(forgeOfUrl("https://git.kopee.me/infra/ansible.git"), null);
    assert.equal(forgeOfUrl("https://code.example.org/x/y.git"), null);
  });

  it("is not fooled by a host containing the name", () => {
    assert.equal(forgeOfUrl("https://github.com.evil.example/x/y"), null);
    assert.equal(forgeOfUrl("https://notgitlab.com/x/y"), null);
  });

  it("returns null on an unreadable URL rather than throwing", () => {
    assert.equal(forgeOfUrl("not a url"), null);
  });
});

describe("pathOfRepoUrl: URL grammar shared by both forges", () => {
  it("strips .git and trailing slashes", () => {
    assert.equal(pathOfRepoUrl("https://github.com/ou-pas/legion.git"), "ou-pas/legion");
    assert.equal(pathOfRepoUrl("https://gitlab.com/kopee/api/"), "kopee/api");
  });

  it("keeps nested groups whole: the point of an opaque path", () => {
    // GitLab allows `group/subgroup/project`, which GitHub's owner/repo pair cannot represent: why the
    // port only knows a path.
    assert.equal(pathOfRepoUrl("https://gitlab.com/kopee/back/api.git"), "kopee/back/api");
    assert.equal(pathOfRepoUrl("https://git.kopee.me/a/b/c/d.git"), "a/b/c/d");
  });

  // v40: the path does not depend on how the repository is reached. Returning `null` on an SSH URL did
  // not prevent a clone (this module does not clone): it prevented opening the change request. The
  // agent would have pushed its branch and left without a PR, silently.
  it("reads the scp form like the https form: the same repository", () => {
    assert.equal(pathOfRepoUrl("git@github.com:ou-pas/legion.git"), "ou-pas/legion");
    assert.equal(pathOfRepoUrl("git@gitlab.com:kopee/back/api.git"), "kopee/back/api");
    assert.equal(pathOfRepoUrl("ssh://git@github.com/ou-pas/legion.git"), "ou-pas/legion");
  });

  it("refuses plain http: not a forge we want to call", () => {
    assert.equal(pathOfRepoUrl("http://gitlab.com/x/y"), null);
  });

  it("hostOfRepoUrl reads both grammars, `new URL` knows one", () => {
    assert.equal(hostOfRepoUrl("git@github.com:o/r.git"), "github.com");
    assert.equal(hostOfRepoUrl("https://GitHub.com/o/r.git"), "github.com");
    assert.equal(hostOfRepoUrl("ssh://git@gitlab.com/o/r.git"), "gitlab.com");
    // An SSH alias from `~/.ssh/config` is a host like any other for this module: the proxy allowlist
    // and preflight decide whether it is reachable.
    assert.equal(hostOfRepoUrl("git@github-legion:ou-pas/legion.git"), "github-legion");
    assert.equal(hostOfRepoUrl("not a url"), null);
  });

  it("isSshRepoUrl separates the two worlds", () => {
    assert.equal(isSshRepoUrl("git@github.com:o/r.git"), true);
    assert.equal(isSshRepoUrl("ssh://git@github.com/o/r.git"), true);
    assert.equal(isSshRepoUrl("https://github.com/o/r.git"), false);
  });
});

/** Sets (or removes) the variable for one test, and restores it as it was. */
function withForgeHosts(value: string | undefined, run: () => void): void {
  const before = process.env[FORGE_HOSTS_VAR];
  if (value === undefined) delete process.env[FORGE_HOSTS_VAR];
  else process.env[FORGE_HOSTS_VAR] = value;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env[FORGE_HOSTS_VAR];
    else process.env[FORGE_HOSTS_VAR] = before;
  }
}

describe("forgeHostRefusal: which hosts a token may be presented to (05/09)", () => {
  it("both public forges pass, in both grammars, whatever the case", () => {
    withForgeHosts(undefined, () => {
      assert.equal(forgeHostRefusal("https://github.com/o/r.git"), null);
      assert.equal(forgeHostRefusal("git@gitlab.com:g/sg/p.git"), null);
      assert.equal(forgeHostRefusal("ssh://git@GitHub.com/o/r.git"), null);
    });
  });

  it("an unknown host is refused by name, with the variable that would admit it", () => {
    // The defect this closes: the token went to the URL's host, whatever it was. The refusal must say
    // what to do, or the human searches the secrets.
    withForgeHosts(undefined, () => {
      const refusal = forgeHostRefusal("https://git.evil.example/o/r.git");
      assert.ok(refusal);
      assert.match(refusal, /git\.evil\.example/);
      assert.match(refusal, /LEGION_FORGE_HOSTS/);
    });
  });

  it("a declared host passes, over SSH and https, port included, and the public ones remain", () => {
    withForgeHosts(" Git.Kopee.me , gitlab.local:8443,, ", () => {
      assert.equal(forgeHostRefusal("git@git.kopee.me:ops/ansible.git"), null);
      assert.equal(forgeHostRefusal("https://gitlab.local:8443/g/p.git"), null);
      assert.equal(forgeHostRefusal("https://github.com/o/r.git"), null);
      assert.deepEqual(
        [...allowedForgeHosts()],
        ["github.com", "gitlab.com", "git.kopee.me", "gitlab.local:8443"],
      );
    });
  });

  it("exact comparison: no subdomain, no host containing the name, no unreadable URL", () => {
    withForgeHosts(undefined, () => {
      assert.ok(forgeHostRefusal("https://github.com.evil.example/o/r.git"));
      assert.ok(forgeHostRefusal("https://evil.github.com/o/r.git"));
      assert.ok(forgeHostRefusal("not a url"));
    });
  });
});

describe("effectiveForge: the rule deciding whom a token is presented to", () => {
  it("the declaration wins over the host", () => {
    // A self-hosted GitLab: the host says nothing, the declaration says everything.
    assert.equal(
      effectiveForge({ url: "https://git.kopee.me/ops/ansible.git", forge: "gitlab" }),
      "gitlab",
    );
    // And the reverse: an explicit declaration is never overwritten by a guess.
    assert.equal(effectiveForge({ url: "https://github.com/o/r.git", forge: "gitlab" }), "gitlab");
  });

  it("without a declaration, a certain host is authoritative", () => {
    assert.equal(effectiveForge({ url: "https://github.com/o/r.git", forge: null }), "github");
    assert.equal(effectiveForge({ url: "https://gitlab.com/g/p.git" }), "gitlab");
  });

  it("without a declaration on a third-party host: null, never github by default", () => {
    // The guarantee replacing the `host === "github.com"` filter removed from the runner. Reading a
    // forge-less row as GitHub was right while GitHub was the only forge; afterwards it would present
    // the GitHub PAT to bitbucket.org.
    assert.equal(effectiveForge({ url: "https://bitbucket.org/acme/lib.git", forge: null }), null);
    assert.equal(effectiveForge({ url: "https://git.interne.fr/x/y.git" }), null);
  });

  it("an unknown forge value in the database does not pass as a declaration", () => {
    assert.equal(
      effectiveForge({ url: "https://bitbucket.org/a/b.git", forge: "bitbucket" }),
      null,
    );
  });
});

describe("the registry", () => {
  it("returns the adapter of each declared forge", () => {
    for (const kind of FORGE_KINDS) assert.equal(forgeFor(kind).kind, kind);
  });

  it("each adapter names the change request in its own vocabulary", () => {
    // Humans read "merge request" on GitLab. The code keeps a neutral name, the UI does not.
    assert.equal(forgeFor("github").changeRequestLabel, "pull request");
    assert.equal(forgeFor("gitlab").changeRequestLabel, "merge request");
  });

  it("an unregistered forge throws rather than returning undefined", () => {
    // A wiring defect must show at the call, not three lines later as a "cannot read property of
    // undefined" naming nothing.
    assert.throws(() => forgeFor("bitbucket" as never), /not registered/);
  });

  it("isForgeKind does not let any string through", () => {
    assert.equal(isForgeKind("gitlab"), true);
    assert.equal(isForgeKind("GitLab"), false, "case matters: an identifier, not a label");
    assert.equal(isForgeKind("bitbucket"), false);
    assert.equal(isForgeKind(undefined), false);
  });
});

describe("countDiffLines: because one forge out of two does not count for us", () => {
  it("counts added and removed lines of a unified diff", () => {
    const patch = "@@ -1,3 +1,4 @@\n contexte\n-vieux\n+neuf\n+ajout\n contexte";
    assert.deepEqual(countDiffLines(patch), { additions: 2, deletions: 1 });
  });

  it("does not count +++ / --- headers before the first @@", () => {
    // Counting them would shift each file by one addition and one removal. In practice neither GitHub
    // nor GitLab emits these headers (patches start at `@@`), so this guard only matters if one changes.
    const patch = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b";
    assert.deepEqual(countDiffLines(patch), { additions: 1, deletions: 1 });
  });

  it("counts a content line that looks like a header", () => {
    // The false negative the first version created, unseen by any test: skipping everything starting
    // with `---` everywhere skipped the removal of a YAML separator (`---` removed is `----`), a SQL
    // comment (`-- x` → `--- x`), a Markdown underline. The file showed fewer deletions, silently.
    const patch = "@@ -1,4 +1,3 @@\n----\n-- commentaire SQL\n+++ajout\n contexte";
    assert.deepEqual(countDiffLines(patch), { additions: 1, deletions: 2 });
  });

  it("returns 0/0 on a missing diff: binary, too large, collapsed", () => {
    assert.deepEqual(countDiffLines(null), { additions: 0, deletions: 0 });
    assert.deepEqual(countDiffLines(""), { additions: 0, deletions: 0 });
  });
});

describe("numberOfChangeRequestUrl: the one datum a `PrUrl` ({repo, url}) does not carry", () => {
  it("reads the last numeric segment, GitHub and GitLab shapes alike", () => {
    assert.equal(numberOfChangeRequestUrl("https://github.com/o/r/pull/62"), 62);
    assert.equal(numberOfChangeRequestUrl("https://gitlab.com/g/sg/p/-/merge_requests/311"), 311);
  });

  it("tolerates a trailing slash, query or fragment", () => {
    assert.equal(numberOfChangeRequestUrl("https://github.com/o/r/pull/62/"), 62);
    assert.equal(numberOfChangeRequestUrl("https://github.com/o/r/pull/62?tab=files"), 62);
    assert.equal(numberOfChangeRequestUrl("https://github.com/o/r/pull/62#discussion"), 62);
  });

  it("returns null on a URL not ending with a number: never guessed", () => {
    assert.equal(numberOfChangeRequestUrl("https://github.com/mock/front/pull/0/files"), null);
    assert.equal(numberOfChangeRequestUrl("https://example.com/not-a-number"), null);
    assert.equal(numberOfChangeRequestUrl(""), null);
  });
});

describe("forgeInstanceHost: whom this token belongs to", () => {
  const withVar = <T>(value: string | undefined, run: () => T): T => {
    const before = process.env[GITLAB_HOST_VAR];
    if (value === undefined) delete process.env[GITLAB_HOST_VAR];
    else process.env[GITLAB_HOST_VAR] = value;
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env[GITLAB_HOST_VAR];
      else process.env[GITLAB_HOST_VAR] = before;
    }
  };

  it("what is set on the connection wins over the instance default", () => {
    withVar("https://git.kopee.me", () => {
      assert.equal(forgeInstanceHost("gitlab", "https://framagit.org"), "framagit.org");
    });
  });

  it("without a set field, the instance default serves", () => {
    withVar("https://git.kopee.me/", () => {
      assert.equal(forgeInstanceHost("gitlab", null), "git.kopee.me");
    });
  });

  it("without field or default, the public host, never nothing", () => {
    withVar(undefined, () => {
      assert.equal(forgeInstanceHost("gitlab", null), "gitlab.com");
    });
  });

  it("scheme and trailing slash go: the API wants a host, not a URL", () => {
    withVar(undefined, () => {
      assert.equal(forgeInstanceHost("gitlab", "https://git.example.com/"), "git.example.com");
      assert.equal(forgeInstanceHost("gitlab", "  http://git.example.com  "), "git.example.com");
    });
  });

  it("an empty or blank field does not count as a declaration", () => {
    withVar(undefined, () => {
      assert.equal(forgeInstanceHost("gitlab", "   "), "gitlab.com");
    });
  });

  it("GitHub stays on its public host whatever it is given: `gh()` talks to a constant", () => {
    withVar("https://git.kopee.me", () => {
      assert.equal(forgeInstanceHost("github", "https://github.acme.test"), "github.com");
    });
  });
});

describe("withForgeTimeout: the timeout undici does not set", () => {
  it("returns the value when the forge answers", async () => {
    assert.equal(await withForgeTimeout("test read", async () => "ok", 500), "ok");
  });

  it("throws when it never answers, naming what was being read", async () => {
    // Without it `undici` allows 300 s of `headersTimeout`: a `POST /api/repos` stayed open five minutes
    // with the repository row already written. The label reaches humans: "the forge did not answer"
    // would not say what is missing.
    await assert.rejects(
      () => withForgeTimeout("test read", () => new Promise(() => {}), 10),
      /test read > 10 ms/,
    );
  });

  it("the timer is cleared on return: this test must not hold the process", async () => {
    // `finally` does the work. `unref` looked cleaner and removed the only thing keeping the event loop
    // awake while waiting: the call never returned.
    const started = Date.now();
    await withForgeTimeout("test read", async () => "fast", 30_000);
    assert.ok(Date.now() - started < 1_000);
  });
});
