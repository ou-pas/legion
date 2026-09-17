// The GitHub adapter. It had no test before 26/08 because it was inseparable from the database (it
// resolved its own token with `githubToken(projectId)` and `db.select()`). Making it humble (token as
// argument, no database) had a side effect maybe worth more than the port itself: it can finally be
// exercised. Same setup as gitlab.test.ts, `globalThis.fetch` replaced.
//
// Priority: observable behaviours a refactor can drop without any type noticing: the 404 meaning
// "nothing pushed here" rather than an error, idempotence on 422, the `legion/*` filter, the message
// saying what to fix.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { checksReportOfRuns, githubForge } from "./github.js";
import type { ForgeRepo } from "./forge.js";

const REPO: ForgeRepo = {
  name: "legion",
  url: "https://github.com/ou-pas/legion.git",
  forge: "github",
};

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeApi(routes: (url: string, init?: RequestInit) => Reply): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const { status = 200, json = {}, headers = {} } = routes(url, init);
    return {
      status,
      json: async () => json,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

describe("projectPath: two segments, nothing else", () => {
  it("reads owner/repo, with or without .git", () => {
    assert.equal(githubForge.projectPath("https://github.com/ou-pas/legion.git"), "ou-pas/legion");
    assert.equal(githubForge.projectPath("https://github.com/ou-pas/legion"), "ou-pas/legion");
  });

  it("refuses another forge's URL rather than passing it off as a GitHub path", () => {
    // The "two segments are enough" fallback was written for GitHub Enterprise. It unlocked nothing
    // (Enterprise does not live on api.github.com) and replaced "non-GitHub URL", which says what to fix,
    // with "repository unreachable (404)", which sends people checking permissions.
    assert.equal(githubForge.projectPath("https://gitlab.com/kopee/api.git"), null);
    assert.equal(githubForge.projectPath("https://git.kopee.me/ops/ansible.git"), null);
  });

  it("refuses a three-segment path: the /repos/:owner/:repo API takes no more", () => {
    assert.equal(githubForge.projectPath("https://github.com/a/b/c"), null);
  });
});

describe("compareBranch", () => {
  it("compares with the default branch read from the repository, not an assumed main", async () => {
    const { calls } = fakeApi((url) =>
      url.includes("/compare/") ? { json: { files: [] } } : { json: { default_branch: "trunk" } },
    );
    await githubForge.compareBranch("tok", REPO, "legion/t1");
    assert.ok(calls[1]!.includes("/compare/trunk...legion%2Ft1"), calls[1]);
  });

  it("404 on compare means the branch was never pushed here, not an error", async () => {
    // The distinction the whole pre-review screen rests on: `files: null` + `error: null` means
    // "nothing here", a non-null `error` means "could not look".
    fakeApi((url) =>
      url.includes("/compare/") ? { status: 404 } : { json: { default_branch: "main" } },
    );
    const out = await githubForge.compareBranch("tok", REPO, "legion/never");
    assert.equal(out.files, null);
    assert.equal(out.error, null);
  });

  it("an unreachable repository is named, without throwing", async () => {
    fakeApi(() => ({ status: 403 }));
    const out = await githubForge.compareBranch("tok", REPO, "legion/t1");
    assert.match(out.error!, /403/);
  });

  it("an omitted `patch` stays null: binary or file too large", async () => {
    fakeApi((url) =>
      url.includes("/compare/")
        ? {
            json: {
              files: [{ filename: "logo.png", status: "modified", additions: 0, deletions: 0 }],
            },
          }
        : { json: { default_branch: "main" } },
    );
    const out = await githubForge.compareBranch("tok", REPO, "legion/t1");
    assert.equal(out.files![0]!.patch, null);
  });

  it("demo mode returns a diff without touching the network", async () => {
    const before = process.env.LEGION_GITHUB_FAKE;
    process.env.LEGION_GITHUB_FAKE = "1";
    globalThis.fetch = (() => {
      throw new Error("demo mode must call nothing");
    }) as unknown as typeof fetch;
    try {
      const out = await githubForge.compareBranch("", REPO, "legion/t1");
      assert.equal(out.error, null);
      assert.ok(out.files!.length > 0);
    } finally {
      if (before === undefined) delete process.env.LEGION_GITHUB_FAKE;
      else process.env.LEGION_GITHUB_FAKE = before;
    }
  });
});

describe("listOpen", () => {
  it("keeps only legion/* branches and merges both kinds of comments", async () => {
    // GitHub separates code comments (`/pulls/:n/comments`) from discussion comments
    // (`/issues/:n/comments`). Both count for a review; reading one lost half of the operator's feedback.
    fakeApi((url) => {
      if (url.includes("/pulls?state=open"))
        return {
          json: [
            {
              number: 7,
              title: "feat",
              html_url: "https://github.com/o/r/pull/7",
              head: { ref: "legion/t1" },
            },
            {
              number: 8,
              title: "manual",
              html_url: "https://github.com/o/r/pull/8",
              head: { ref: "hotfix" },
            },
          ],
        };
      if (url.includes("/pulls/7/comments"))
        return {
          json: [
            {
              id: 1,
              user: { login: "operateur" },
              body: "code",
              path: "a.ts",
              html_url: "u1",
              created_at: "2026-08-26T10:00:00Z",
            },
          ],
        };
      if (url.includes("/issues/7/comments"))
        return {
          json: [
            {
              id: 2,
              user: { login: "operateur" },
              body: "discussion",
              html_url: "u2",
              created_at: "2026-08-26T09:00:00Z",
            },
          ],
        };
      if (url.endsWith("/pulls/7")) return { json: { mergeable: false } };
      return { json: [] };
    });
    const out = await githubForge.listOpen("tok", REPO);
    assert.equal(out.length, 1, "the PR outside legion/* is ignored");
    assert.deepEqual(
      out[0]!.comments.map((c) => c.body),
      ["discussion", "code"],
      "sorted by date, not source",
    );
    assert.equal(out[0]!.comments[1]!.path, "a.ts");
    assert.equal(
      out[0]!.mergeState,
      "conflict",
      "the PR detail (mergeable) is read, not just the list",
    );
  });

  it("stops before exhausting the quota, and says so", async () => {
    fakeApi(() => ({ json: [], headers: { "x-ratelimit-remaining": "0" } }));
    await assert.rejects(() => githubForge.listOpen("tok", REPO), /rate limit/);
  });
});

describe("mergeState: `mergeable` exists only on a PR detail, and is computed lazily", () => {
  it("true → mergeable, false → conflict", async () => {
    fakeApi((url) => ({ json: { mergeable: url.endsWith("/1") } }));
    assert.equal(await githubForge.mergeState("tok", REPO, 1), "mergeable");
    assert.equal(await githubForge.mergeState("tok", REPO, 2), "conflict");
  });

  it("`null` (computation running at GitHub) is never mapped to mergeable", async () => {
    fakeApi(() => ({ json: { mergeable: null } }));
    assert.equal(await githubForge.mergeState("tok", REPO, 1), "unknown");
  });

  it("an unreachable repository or non-GitHub URL returns unknown, never an exception", async () => {
    fakeApi(() => ({ status: 404 }));
    assert.equal(await githubForge.mergeState("tok", REPO, 1), "unknown");
    assert.equal(
      await githubForge.mergeState(
        "tok",
        { name: "x", url: "https://gitlab.com/o/r", forge: "gitlab" },
        1,
      ),
      "unknown",
    );
  });

  it("demo mode returns fake PR states without touching the network", async () => {
    const before = process.env.LEGION_GITHUB_FAKE;
    process.env.LEGION_GITHUB_FAKE = "1";
    globalThis.fetch = (() => {
      throw new Error("demo mode must call nothing");
    }) as unknown as typeof fetch;
    try {
      assert.equal(await githubForge.mergeState("", REPO, 7), "conflict");
      assert.equal(await githubForge.mergeState("", REPO, 999), "unknown");
    } finally {
      if (before === undefined) delete process.env.LEGION_GITHUB_FAKE;
      else process.env.LEGION_GITHUB_FAKE = before;
    }
  });
});

describe("create: idempotence", () => {
  it("returns the created PR's URL", async () => {
    fakeApi((url, init) =>
      init?.method === "POST"
        ? { status: 201, json: { html_url: "https://github.com/o/r/pull/12" } }
        : { json: { default_branch: "main" } },
    );
    const res = await githubForge.create("tok", REPO, {
      branch: "legion/t1",
      title: "T",
      body: "B",
    });
    assert.deepEqual(res, { ok: true, url: "https://github.com/o/r/pull/12", existing: false });
  });

  it("finds the already open PR on 422, and never returns a closed PR", async () => {
    // `state=open` in the search: without it an old merged PR was presented as the branch's PR, and the
    // operator believed their work delivered.
    let searched = "";
    fakeApi((url, init) => {
      if (init?.method === "POST") return { status: 422, json: { message: "already exists" } };
      if (url.includes("/pulls?head=")) {
        searched = url;
        return { json: [{ html_url: "https://github.com/o/r/pull/3" }] };
      }
      return { json: { default_branch: "main" } };
    });
    const res = await githubForge.create("tok", REPO, {
      branch: "legion/t1",
      title: "T",
      body: "B",
    });
    assert.deepEqual(res, { ok: true, url: "https://github.com/o/r/pull/3", existing: true });
    assert.ok(searched.includes("state=open"), searched);
    assert.ok(searched.includes("head=ou-pas:legion%2Ft1"), searched);
  });

  it("a 422 with no PR to find is a detailed error, not a success", async () => {
    fakeApi((url, init) => {
      if (init?.method === "POST")
        return {
          status: 422,
          json: { errors: [{ message: "No commits between main and legion/t1" }] },
        };
      if (url.includes("/pulls?head=")) return { json: [] };
      return { json: { default_branch: "main" } };
    });
    const res = await githubForge.create("tok", REPO, {
      branch: "legion/t1",
      title: "T",
      body: "B",
    });
    assert.equal(res.ok, false);
    assert.match(res.ok === false ? res.error : "", /No commits between/);
  });
});

describe("checks: the CI verdict, never green by default", () => {
  it("a red job wins over jobs still running: there is already something to act on", () => {
    const report = checksReportOfRuns([
      { id: 1, name: "lint", status: "completed", conclusion: "success" },
      {
        id: 2,
        name: "tests",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/o/r/runs/2",
        details_url: "https://github.com/o/r/actions/runs/9/job/102031171336",
      },
      { id: 3, name: "build", status: "in_progress" },
    ]);
    assert.equal(report.state, "failing");
    assert.deepEqual(report.failing, [
      { id: "102031171336", name: "tests", url: "https://github.com/o/r/runs/2" },
    ]);
  });

  it("checks still running are pending, never passing", () => {
    assert.equal(checksReportOfRuns([{ id: 1, name: "tests", status: "queued" }]).state, "pending");
  });

  it("no check run means unknown: a commit-statuses repository, or a token without rights", () => {
    assert.deepEqual(checksReportOfRuns([]), { state: "unknown", failing: [] });
  });

  it("a cancelled or skipped job is not a failure: it said nothing about the code", () => {
    const report = checksReportOfRuns([
      { id: 1, name: "tests", status: "completed", conclusion: "cancelled" },
      { id: 2, name: "e2e", status: "completed", conclusion: "skipped" },
    ]);
    assert.equal(report.state, "passing");
  });

  it("reads the check runs of the PR head, reread at that moment", async () => {
    const { calls } = fakeApi((url) =>
      url.includes("/check-runs")
        ? {
            json: {
              check_runs: [
                {
                  id: 7,
                  name: "tests",
                  status: "completed",
                  conclusion: "failure",
                  details_url: "https://github.com/o/r/actions/runs/9/job/42",
                },
              ],
            },
          }
        : { json: { head: { sha: "abc123" } } },
    );
    const report = await githubForge.checks("tok", REPO, 565);
    assert.equal(report.state, "failing");
    assert.equal(report.failing[0]!.id, "42");
    assert.ok(
      calls.some((u) => u.includes("/commits/abc123/check-runs")),
      calls.join("\n"),
    );
  });

  it("a refusing forge (403 without actions:read) returns unknown, not passing", async () => {
    fakeApi((url) =>
      url.includes("/check-runs") ? { status: 403, json: {} } : { json: { head: { sha: "abc" } } },
    );
    assert.deepEqual(await githubForge.checks("tok", REPO, 1), { state: "unknown", failing: [] });
  });
});

describe("checkLog: the job's raw output, or a null that cancels nothing", () => {
  it("asks for the job log (id read from details_url) and returns its text", async () => {
    let asked = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      asked = String(input);
      return {
        ok: true,
        status: 200,
        text: async () => "FAIL src/a.test.ts",
      } as unknown as Response;
    }) as typeof fetch;
    assert.equal(await githubForge.checkLog("tok", REPO, "42"), "FAIL src/a.test.ts");
    assert.equal(asked, "https://api.github.com/repos/ou-pas/legion/actions/jobs/42/logs");
  });

  it("a forge refusal returns null, never an exception", async () => {
    globalThis.fetch = (async () =>
      ({ ok: false, status: 403, text: async () => "" }) as unknown as Response) as typeof fetch;
    assert.equal(await githubForge.checkLog("tok", REPO, "42"), null);
  });

  it("a non-numeric id is never sent to the API", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return {} as Response;
    }) as typeof fetch;
    assert.equal(await githubForge.checkLog("tok", REPO, "check-run-9"), null);
    assert.equal(called, false);
  });
});

describe("listRepos: discovery, and the difference between nothing and unknown", () => {
  const page = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      full_name: `ou-pas/r${i}`,
      clone_url: `https://github.com/ou-pas/r${i}.git`,
      private: i % 2 === 0,
      default_branch: "main",
    }));

  it("names the three affiliations: without them organisation repositories are missing", async () => {
    const { calls } = fakeApi(() => ({ json: [] }));
    await githubForge.listRepos("tok", "github.com");
    assert.match(calls[0]!, /affiliation=owner,collaborator,organization_member/);
    assert.match(calls[0]!, /per_page=100/);
  });

  it("translates what GitHub returns, recomposing nothing", async () => {
    fakeApi(() => ({ json: page(1) }));
    const found = await githubForge.listRepos("tok", "github.com");
    assert.deepEqual(found, [
      {
        fullName: "ou-pas/r0",
        url: "https://github.com/ou-pas/r0.git",
        private: true,
      },
    ]);
  });

  it("an incomplete page stops pagination: one call for 22 repositories", async () => {
    const { calls } = fakeApi(() => ({ json: page(22) }));
    const found = await githubForge.listRepos("tok", "github.com");
    assert.equal(found?.length, 22);
    assert.equal(calls.length, 1);
  });

  it("the cap holds: three full pages, not one more", async () => {
    const { calls } = fakeApi(() => ({ json: page(100) }));
    const found = await githubForge.listRepos("tok", "github.com");
    assert.equal(calls.length, 3);
    assert.equal(found?.length, 300);
  });

  it("a refusal returns `null`, never an empty list reading as no repositories", async () => {
    fakeApi(() => ({ status: 403, json: { message: "Bad credentials" } }));
    assert.equal(await githubForge.listRepos("tok", "github.com"), null);
  });

  it("an account without repositories returns an empty list, a different answer", async () => {
    fakeApi(() => ({ json: [] }));
    assert.deepEqual(await githubForge.listRepos("tok", "github.com"), []);
  });

  it("a network failure returns `null`, not an exception that would break the UI", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    assert.equal(await githubForge.listRepos("tok", "github.com"), null);
  });

  it("a page failing after the first truncates, it does not erase", async () => {
    let n = 0;
    fakeApi(() => (++n === 1 ? { json: page(100) } : { status: 502, json: {} }));
    const found = await githubForge.listRepos("tok", "github.com");
    assert.equal(found?.length, 100);
  });
});

describe("listRepos: a slow page truncates, it does not erase (round 2)", () => {
  it("page 2 never answers: page 1's 100 repositories are returned", async () => {
    // The defect this closes: the timeout wrapped `listRepos`, so all three pages; a slow third page
    // rejected the outer race and the partial result this loop promises was thrown away. The timeout
    // is now per page, the only place preserving the promise.
    //
    // It lasts the real timeout (5 s), deliberately: making it injectable down to the adapter would add
    // a port parameter for a one-line fact. The only slow test of the repository, guarding what round
    // 2 named the costliest.
    let n = 0;
    globalThis.fetch = (async () => {
      if (++n === 1)
        return {
          status: 200,
          json: async () =>
            Array.from({ length: 100 }, (_, i) => ({
              full_name: `ou-pas/r${i}`,
              clone_url: `https://github.com/ou-pas/r${i}.git`,
              private: false,
            })),
          headers: { get: () => null },
        } as unknown as Response;
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const found = await githubForge.listRepos("tok", "github.com");
    assert.equal(found?.length, 100, "page 1 survives page 2's silence");
  });
});
