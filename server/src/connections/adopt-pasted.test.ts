// Adopting pasted tokens against a real database: what is checked is what was written; a database
// double would only prove writing to a double.
//
// Three facts that make the command safe to re-run without thinking:
//   · a refused token writes nothing, or the UI would say "connected" for a dead credential;
//   · an unreachable provider writes nothing either, a different case from refusal (replayable
//     tomorrow, a refusal is not);
//   · a second run finds nothing to do.
//
// And the separate case: `LINEAR_API_KEY` adopted as `LINEAR_TOKEN` with the observed header format;
// without it adoption would make a connection that looks alive and is not.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-adopt-pasted-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { putSecret } = await import("../projects/secrets.js");
const { secretRowFor } = await import("./connections-store.js");
const { freshAuthorization } = await import("./secret-access.js");
const { ADOPT_OUTCOME, adoptPastedTokens, LEGACY_LINEAR_NAME } = await import("./adopt-pasted.js");
const { AUTH_FORMAT, PROVIDER, TOKEN_ORIGIN } = await import("./providers.js");
// The three adapters register at import, as in `routes.ts` and the script.
await import("./github-device.js");
await import("./gitlab-device.js");
await import("./linear-redirect.js");

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** GitHub says yes, with an account and scopes in a header: the richest answer, so the best proof the
 *  probe travels to the column. */
function githubSaysYes(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ login: "octocat" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-oauth-scopes": "repo, read:org" },
    })) as typeof fetch;
}

/** Linear accepts one header format and refuses the other, which is what lets the format be observed. */
function linearAccepts(authorized: string): void {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const presented = new Headers(init?.headers).get("authorization") ?? "";
    if (presented !== authorized)
      return new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    return new Response(
      JSON.stringify({ data: { viewer: { id: "u1", name: "Mona", email: "mona@example.test" } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

/** A clean database before each case: adoption looks at all projects, so leftovers from one test would
 *  change another's report. */
beforeEach(() => {
  db.delete(schema.secrets).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: "p1", name: "one", slug: "one", createdAt: new Date() })
    .run();
});

/** A secret stored without `metadata`: what a hand paste in the Secrets card left before this work.
 *  `putSecret` without `metadata` writes NULL. */
function pasted(name: string, value: string, projectId = "p1"): void {
  putSecret({ projectId, name, value });
}

describe("adoptPastedTokens: what gets written", () => {
  it("writes what the provider answered, nothing more", async () => {
    githubSaysYes();
    pasted("GITHUB_TOKEN", "ghp_pasted");

    const reports = await adoptPastedTokens();

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.adopted);
    const metadata = JSON.parse(secretRowFor("p1", "GITHUB_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(metadata.provider, PROVIDER.github);
    assert.equal(metadata.account, "octocat");
    assert.deepEqual(metadata.scopes, ["repo", "read:org"]);
  });

  it("keeps the already written format when the probe says nothing", async () => {
    // The coupling nobody named (round 1): `attachSecretMetadata` replaces the whole column. The
    // `LINEAR_TOKEN` set by data patch p1 carries `authFormat: raw`, inferred from the original row's
    // name, and the GitHub and GitLab probes do not return that field (`Adopted` allows it). Without
    // preservation, enrichment would erase the format, absent would mean `bearer`, and the token would
    // be presented wrongly.
    githubSaysYes();
    putSecret({ projectId: "p1", name: "GITHUB_TOKEN", value: "ghp_raw" });
    db.update(schema.secrets)
      .set({ metadata: JSON.stringify({ origin: "pasted", authFormat: AUTH_FORMAT.raw }) })
      .where(eq(schema.secrets.name, "GITHUB_TOKEN"))
      .run();

    await adoptPastedTokens();

    const metadata = JSON.parse(secretRowFor("p1", "GITHUB_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(
      metadata.authFormat,
      AUTH_FORMAT.raw,
      "the probe has no opinion, so it does not erase",
    );
    assert.equal(metadata.account, "octocat", "and what it observed, it writes");
    assert.equal(
      freshAuthorization("p1", "GITHUB_TOKEN"),
      "ghp_raw",
      "the preserved format is the one the header uses",
    );
  });

  it("writes when the provider answered, even if it found nothing", async () => {
    // Linear always returns `scopes: null`: without `probedAt`, a probe also finding no account would
    // write nothing distinctive and the row would come back on every run.
    githubSaysYes();
    pasted("GITHUB_TOKEN", "ghp_pasted");
    const before = Date.now();

    await adoptPastedTokens();

    const metadata = JSON.parse(secretRowFor("p1", "GITHUB_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.ok(typeof metadata.probedAt === "number" && metadata.probedAt >= before);
  });

  it("does not touch the token value: adoption enriches, it does not rewrite", async () => {
    githubSaysYes();
    pasted("GITHUB_TOKEN", "ghp_pasted");

    await adoptPastedTokens();

    assert.equal(freshAuthorization("p1", "GITHUB_TOKEN"), "Bearer ghp_pasted");
  });

  it("leaves intact a row already carrying metadata, even unreadable", async () => {
    githubSaysYes();
    putSecret({ projectId: "p1", name: "GITHUB_TOKEN", value: "ghp_already" });
    db.update(schema.secrets).set({ metadata: "{truncated" }).run();

    const reports = await adoptPastedTokens();

    assert.deepEqual(reports, [], "it has one: overwriting would erase what someone wrote");
    assert.equal(secretRowFor("p1", "GITHUB_TOKEN")!.metadata, "{truncated");
  });

  it("ignores a secret belonging to no provider", async () => {
    githubSaysYes();
    pasted("SLACK_TOKEN", "xoxb-peu-importe");

    assert.deepEqual(await adoptPastedTokens(), []);
    assert.equal(secretRowFor("p1", "SLACK_TOKEN")!.metadata, null);
  });

  // Writes only on the probed row. A write losing its `WHERE` would stamp the whole database with one
  // provider's `metadata` (a GitHub account shown on another project's Slack secret). Nothing held this:
  // other tests store one secret at a time, so an unfiltered `UPDATE` went unnoticed.
  it("writes only on the probed row, not its neighbours", async () => {
    githubSaysYes();
    pasted("GITHUB_TOKEN", "ghp_pasted");
    pasted("SLACK_TOKEN", "xoxb-voisin");
    db.insert(schema.projects)
      .values({ id: "p2", name: "two", slug: "two", createdAt: new Date() })
      .run();
    pasted("SLACK_TOKEN", "xoxb-ailleurs", "p2");

    await adoptPastedTokens();

    assert.notEqual(secretRowFor("p1", "GITHUB_TOKEN")!.metadata, null);
    assert.equal(secretRowFor("p1", "SLACK_TOKEN")!.metadata, null);
    assert.equal(secretRowFor("p2", "SLACK_TOKEN")!.metadata, null);
  });
});

describe("adoptPastedTokens: what is never written", () => {
  it("a refused token writes nothing", async () => {
    // 401: `probe` reads it as a refusal, and it is one.
    globalThis.fetch = (async () =>
      new Response("bad credentials", { status: 401 })) as typeof fetch;
    pasted("GITHUB_TOKEN", "ghp_dead");

    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.refused);
    assert.equal(
      secretRowFor("p1", "GITHUB_TOKEN")!.metadata,
      null,
      "an enriched dead credential would show “connected” for a token that does not work",
    );
  });

  it("an unreachable provider writes nothing, and it is not a refusal", async () => {
    // 502: a transport incident. Reading it as a refusal would send the operator for a new token.
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    pasted("GITHUB_TOKEN", "ghp_valid");

    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.unreachable);
    assert.notEqual(reports[0]!.outcome, ADOPT_OUTCOME.refused);
    assert.equal(secretRowFor("p1", "GITHUB_TOKEN")!.metadata, null);
  });

  // Decryption is under guard, and was not (round 1). It lived outside both loops' `try`: a rotated
  // master key threw, the command stopped on a raw GCM trace, and no later row was probed or reported.
  it("a row that does not decrypt is reported and does not stop the next ones", async () => {
    githubSaysYes();
    pasted("GITHUB_TOKEN", "ghp_good");
    // A damaged ciphertext: what a rotated master key produces, localised.
    db.update(schema.secrets)
      .set({ ciphertext: "this-is-not-a-ciphertext" })
      .where(eq(schema.secrets.name, "GITHUB_TOKEN"))
      .run();
    pasted("GITLAB_TOKEN", "glpat_bon");

    const reports = await adoptPastedTokens();

    const github = reports.find((r) => r.secretName === "GITHUB_TOKEN");
    assert.equal(github?.outcome, ADOPT_OUTCOME.unreadable);
    assert.notEqual(
      github?.outcome,
      ADOPT_OUTCOME.unreachable,
      "waiting does not restore a master key: the report must not say “retry”",
    );
    assert.equal(secretRowFor("p1", "GITHUB_TOKEN")!.metadata, null, "nothing written");
    assert.notEqual(
      reports.find((r) => r.secretName === "GITLAB_TOKEN"),
      undefined,
      "the next row was probed: the loop did not stop",
    );
  });

  it("never copies the token into what it reports", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    pasted("GITHUB_TOKEN", "ghp_ultra_secret");

    const reports = await adoptPastedTokens();

    assert.equal(JSON.stringify(reports).includes("ghp_ultra_secret"), false);
  });
});

describe("adoptPastedTokens: replayable", () => {
  it("a second run finds nothing to do", async () => {
    githubSaysYes();
    pasted("GITHUB_TOKEN", "ghp_pasted");

    const first = await adoptPastedTokens();
    const written = secretRowFor("p1", "GITHUB_TOKEN")!.metadata;
    const second = await adoptPastedTokens();

    assert.equal(first.length, 1);
    assert.deepEqual(second, [], "the first run took the row out of the filter");
    assert.equal(secretRowFor("p1", "GITHUB_TOKEN")!.metadata, written, "nothing moved");
  });

  it("an empty-handed probe also takes the row out of the filter, or it came back forever", async () => {
    // The looping case (round 1). Linear always returns `scopes: null`; a viewer with no name or email
    // returns `account: null`. The provider did answer with nothing to say, and while the filter read
    // "neither account nor scopes" this row came back on every `make adopt-tokens` with the same report.
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const presented = new Headers(init?.headers).get("authorization") ?? "";
      if (presented !== "lin_silent")
        return new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify({ data: { viewer: { id: "u1" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    pasted("LINEAR_TOKEN", "lin_silent");

    const first = await adoptPastedTokens();
    const second = await adoptPastedTokens();

    assert.equal(first[0]!.outcome, ADOPT_OUTCOME.adopted);
    const metadata = JSON.parse(secretRowFor("p1", "LINEAR_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal("account" in metadata, false, "nothing is made up for all that");
    assert.equal("scopes" in metadata, false);
    assert.deepEqual(second, [], "`probedAt` alone says the question was asked");
  });

  it("an unreachable provider is picked up on the next run", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    pasted("GITHUB_TOKEN", "ghp_pasted");
    await adoptPastedTokens();

    githubSaysYes();
    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.adopted, "nothing written is not a lost row");
  });
});

// The separate case. `LINEAR_API_KEY` is read by nobody since the 15/09 break: an instance carrying one
// has a silent Linear.
describe("adoptPastedTokens: LINEAR_API_KEY", () => {
  it("adopts it as LINEAR_TOKEN, with the observed header format", async () => {
    // A personal key: Linear accepts it raw and refuses it as `Bearer`.
    linearAccepts("lin_api_pasted");
    pasted(LEGACY_LINEAR_NAME, "lin_api_pasted");

    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.adopted);
    assert.equal(reports[0]!.writtenAs, "LINEAR_TOKEN");
    assert.equal(
      freshAuthorization("p1", "LINEAR_TOKEN"),
      "lin_api_pasted",
      "without the stored format, adoption makes a connection that looks alive and is not",
    );
    const metadata = JSON.parse(secretRowFor("p1", "LINEAR_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(metadata.authFormat, AUTH_FORMAT.raw);
    assert.equal(metadata.account, "mona@example.test");
  });

  it("does not delete the old row: nothing was ever destroyed in this work", async () => {
    linearAccepts("lin_api_pasted");
    pasted(LEGACY_LINEAR_NAME, "lin_api_pasted");

    await adoptPastedTokens();

    assert.notEqual(secretRowFor("p1", LEGACY_LINEAR_NAME), null);
  });

  it("does not overwrite a LINEAR_TOKEN already in service", async () => {
    linearAccepts("lin_api_pasted");
    pasted(LEGACY_LINEAR_NAME, "lin_api_pasted");
    putSecret({
      projectId: "p1",
      name: "LINEAR_TOKEN",
      value: "lin_oauth_in_service",
      metadata: { provider: PROVIDER.linear },
    });

    const reports = await adoptPastedTokens();

    // The report is found by name, no longer by rank (round 7): the `LINEAR_TOKEN` set here carries
    // `metadata` without `origin` or `probedAt`, so granted-row adoption now handles it, rightly, and
    // reports it before the legacy key. The invariant is kept, not the list order.
    const legacy = reports.find((r) => r.secretName === LEGACY_LINEAR_NAME);
    assert.equal(legacy?.outcome, ADOPT_OUTCOME.skipped);
    assert.equal(
      freshAuthorization("p1", "LINEAR_TOKEN"),
      "Bearer lin_oauth_in_service",
      "`putSecret` replaces: overwriting a token in service with an old key is exactly the damage a replayable script must not do",
    );
  });

  it("a key Linear refuses writes no LINEAR_TOKEN", async () => {
    linearAccepts("another-token");
    pasted(LEGACY_LINEAR_NAME, "lin_api_dead");

    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.refused);
    assert.equal(secretRowFor("p1", "LINEAR_TOKEN"), null);
    assert.notEqual(secretRowFor("p1", LEGACY_LINEAR_NAME), null);
  });

  it("replays safely: the second run skips the adopted key", async () => {
    linearAccepts("lin_api_pasted");
    pasted(LEGACY_LINEAR_NAME, "lin_api_pasted");

    await adoptPastedTokens();
    const second = await adoptPastedTokens();

    assert.equal(second.length, 1);
    assert.equal(second[0]!.outcome, ADOPT_OUTCOME.skipped);
  });
});

// A row lacking what probing needs. The case measured on 15/09: a `GITLAB_TOKEN` stored before the host
// existed does not say which instance it belongs to, and probing it against `gitlab.com` refused a valid
// framagit token with a report blaming the provider, whom nobody had asked.
describe("adoptPastedTokens: a connection that does not say which instance it talks to", () => {
  /** The network is a failure here: if a request leaves, the test must see it. */
  function noNetwork(): void {
    globalThis.fetch = (async () => {
      throw new Error("adoption must call nobody on an incomplete row");
    }) as typeof fetch;
  }

  it("names it rather than attributing a refusal to the provider, and writes nothing", async () => {
    noNetwork();
    pasted("GITLAB_TOKEN", "glpat_sans_hote");

    const reports = await adoptPastedTokens();

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.incomplete);
    assert.notEqual(
      reports[0]!.outcome,
      ADOPT_OUTCOME.refused,
      "a refusal blames the token; here nobody was asked",
    );
    assert.match(String(reports[0]!.why), /GitLab instance URL required/);
    assert.equal(
      secretRowFor("p1", "GITLAB_TOKEN")?.metadata,
      null,
      "nothing is written: the row stays exactly the working one",
    );
  });

  it("the environment does not fill a stored row's silence", async () => {
    const previous = process.env.LEGION_GITLAB_HOST;
    process.env.LEGION_GITLAB_HOST = "https://git.example.com";
    try {
      noNetwork();
      pasted("GITLAB_TOKEN", "glpat_sans_hote");

      const reports = await adoptPastedTokens();

      assert.equal(
        reports[0]!.outcome,
        ADOPT_OUTCOME.incomplete,
        "a stored row never saw the field: lending it the server's host is the silent assumption being removed",
      );
    } finally {
      if (previous === undefined) delete process.env.LEGION_GITLAB_HOST;
      else process.env.LEGION_GITLAB_HOST = previous;
    }
  });

  it("probes on the row's host, and does not erase it when writing", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      const body = String(url).endsWith("/user") ? { username: "rjeanjean" } : { scopes: ["api"] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    putSecret({
      projectId: "p1",
      name: "GITLAB_TOKEN",
      value: "glpat_framagit",
      metadata: {
        provider: PROVIDER.gitlab,
        origin: "pasted",
        fields: { host: "https://framagit.org" },
      },
    });

    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.adopted);
    assert.equal(calls[0], "https://framagit.org/api/v4/user");
    const written = JSON.parse(secretRowFor("p1", "GITLAB_TOKEN")!.metadata!) as {
      account?: string;
      fields?: Record<string, string>;
    };
    assert.equal(written.account, "rjeanjean");
    assert.deepEqual(
      written.fields,
      { host: "https://framagit.org" },
      "`attachSecretMetadata` replaces the column: without carrying it over, adoption would erase the host it just probed with",
    );
  });
});

// Adoption also covers granted tokens (round 6). Since 16/09 a completed flow asks whose token it is;
// nothing already stored benefits, so earlier OAuth connections keep a connected tile with no account.
// This pass finds them. The criterion is `probedAt`, not `account`: a probe naming nobody is normal.
describe("adoptPastedTokens: granted tokens nobody probed", () => {
  /** A flow-obtained connection as `storeToken` wrote it before round 5: origin, scopes, no account. */
  function granted(metadata: Record<string, unknown> = {}): void {
    putSecret({
      projectId: "p1",
      name: "GITHUB_TOKEN",
      value: "ghp_granted",
      metadata: {
        provider: PROVIDER.github,
        origin: TOKEN_ORIGIN.granted,
        scopes: ["repo", "read:org"],
        ...metadata,
      },
    });
  }

  it("a granted row without an account gains it, keeping everything else", async () => {
    githubSaysYes();
    granted({ fields: { host: "https://example.test" } });

    const reports = await adoptPastedTokens();

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.adopted);
    const metadata = JSON.parse(secretRowFor("p1", "GITHUB_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(metadata.account, "octocat");
    // Merge, not replacement: origin, descriptor scopes and instance survive. `constated` would have
    // rewritten `origin: pasted` and dropped the rest.
    assert.equal(metadata.origin, TOKEN_ORIGIN.granted);
    assert.deepEqual(metadata.scopes, ["repo", "read:org"]);
    assert.deepEqual(metadata.fields, { host: "https://example.test" });
    assert.equal(typeof metadata.probedAt, "number");
  });

  it("a granted row already probed is not probed again", async () => {
    let appels = 0;
    globalThis.fetch = (async () => {
      appels++;
      return new Response(JSON.stringify({ login: "quelquun-dautre" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    granted({ account: "octocat", probedAt: 1 });

    const reports = await adoptPastedTokens();

    assert.deepEqual(reports, [], "a second run finds nothing");
    assert.equal(appels, 0, "aucun appel au fournisseur");
    const metadata = JSON.parse(secretRowFor("p1", "GITHUB_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(metadata.account, "octocat", "the known account is not overwritten");
  });

  // A failing probe touches nothing, the rule of this whole file: a transport incident replays
  // tomorrow, it does not write "this token is dead" today.
  it("a failing probe leaves the row unchanged and does not throw", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    granted();
    const avant = secretRowFor("p1", "GITHUB_TOKEN")!.metadata;

    const reports = await adoptPastedTokens();

    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.unreachable);
    assert.equal(secretRowFor("p1", "GITHUB_TOKEN")!.metadata, avant);
    // The token is intact: a convenience probe never loses a valid credential.
    assert.equal(freshAuthorization("p1", "GITHUB_TOKEN"), "Bearer ghp_granted");
  });

  // A timed-out probe is a transport incident like any other (round 6): `probe`'s timeout aborts the
  // `fetch`, the error surfaces, and the row stays as is.
  it("a timed-out probe does not lose the token", async () => {
    let signalVu: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      signalVu = init?.signal;
      // What `AbortSignal.timeout` produces when it fires, without waiting for the real delay.
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as typeof fetch;
    granted();

    const reports = await adoptPastedTokens();

    // The timeout is wired: without it `undici` would give a silent provider 300 seconds.
    assert.ok(signalVu instanceof AbortSignal, "the probe leaves with an abort signal");
    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.unreachable);
    assert.equal(freshAuthorization("p1", "GITHUB_TOKEN"), "Bearer ghp_granted");
  });
});

// The archaeological row, with no `origin` at all (round 7). The SQL said `origin = 'granted'` while the
// rule (`credentialOrigin`, `schemas.ts`) says `metadata.origin ?? granted`. The stricter reading
// excluded exactly the rows this adoption exists for, written before the field existed. On the
// operator's database the only row to adopt was one of them: the script said "nothing to adopt" while
// the UI showed "Connected via OAuth" for the same row.
describe("adoptPastedTokens: rows from before the `origin` field", () => {
  it("metadata without origin is granted, so eligible, and gets its probedAt", async () => {
    githubSaysYes();
    // What `storeToken` wrote before 15/09: a provider, scopes, nothing else (the row seen in the dev
    // database).
    putSecret({
      projectId: "p1",
      name: "GITHUB_TOKEN",
      value: "ghp_archaeo",
      metadata: { provider: PROVIDER.github, scopes: ["repo", "read:org", "user:email"] },
    });

    const reports = await adoptPastedTokens();

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.outcome, ADOPT_OUTCOME.adopted);
    const metadata = JSON.parse(secretRowFor("p1", "GITHUB_TOKEN")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(metadata.account, "octocat");
    assert.equal(typeof metadata.probedAt, "number");
    // The absence of `origin` survives: merging does not invent a field the row never carried, and
    // `credentialOrigin` still reads it as granted.
    assert.equal("origin" in metadata, false);
    assert.deepEqual(metadata.scopes, ["repo", "read:org", "user:email"]);
  });

  it("a row without origin already probed does not come back", async () => {
    let appels = 0;
    globalThis.fetch = (async () => {
      appels++;
      return new Response(JSON.stringify({ login: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    putSecret({
      projectId: "p1",
      name: "GITHUB_TOKEN",
      value: "ghp_archaeo",
      metadata: { provider: PROVIDER.github, scopes: ["repo"], probedAt: 1 },
    });

    assert.deepEqual(await adoptPastedTokens(), []);
    assert.equal(appels, 0);
  });
});
