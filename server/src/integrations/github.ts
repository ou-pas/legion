// GitHub adapter of the `forge.ts` port. Creates PRs from legion/* branches (PR flow, operator's
// request 18/08); the body comes from the pr.md artifact written by the agent (first line is the title,
// the rest the body), previewed and approved by a human before any API call (gate).
//
// Humble since 26/08: it receives its token, reads no database and decrypts nothing. Resolution used to
// live here (`githubToken(projectId)` and a `db.select()`), which made a second adapter impossible
// without duplication. It moved to `forge-access.ts`, once for all forges.
import {
  CHECK_STATE,
  FORGE_DISCOVERY_PAGES,
  FORGE_DISCOVERY_PER_PAGE,
  hostOfRepoUrl,
  pathOfRepoUrl,
  registerForge,
  withForgeTimeout,
  type ChecksReport,
  type CreateResult,
  type DiffFile,
  type FailingCheck,
  type ForgeAdapter,
  type ForgeComment,
  type ForgeRepo,
  type ForgeRepoCandidate,
  type MergeState,
  type OpenChangeRequest,
  type RepoDiff,
  type RepoHookResult,
  type VerifiedEmail,
} from "./forge.js";

/** GitHub's `owner/repo` pair: exactly two segments, unlike GitLab.
 *
 *  Both grammars (v40). A regex anchored on `https://github.com/` was fine while an SSH repository could
 *  not exist. Once a key made `git@github.com:o/r` legitimate, refusing it here does not prevent the
 *  clone (this module does not clone) but prevents opening the pull request: the agent would push and
 *  leave without a PR, with no error saying so.
 *
 *  The host stays constant: `api.github.com` is hard-coded in `gh()`, so accepting another host would
 *  unlock no GitHub Enterprise, only replace "non-GitHub URL", which says what to fix, with a 404 that
 *  sends people checking permissions. */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  if (hostOfRepoUrl(url) !== "github.com") return null;
  const path = pathOfRepoUrl(url);
  const parts = path ? path.split("/") : [];
  return parts.length === 2 ? { owner: parts[0]!, repo: parts[1]! } : null;
}

async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; rateLeft: number | null }> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "legion",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const rl = res.headers.get("x-ratelimit-remaining");
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
    rateLeft: rl !== null ? Number(rl) : null,
  };
}

/** Paginated GET with a reasonable cap: beyond it, stop cleanly rather than miss silently. */
async function ghList(
  token: string,
  path: string,
  maxPages = 3,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await gh(token, "GET", `${path}${sep}page=${page}`);
    if (res.rateLeft !== null && res.rateLeft <= 1)
      throw new Error("GitHub rate limit reached — try again later");
    if (res.status !== 200 || !Array.isArray(res.json)) break;
    const items = res.json as unknown as Record<string, unknown>[];
    out.push(...items);
    if (items.length < 30) break; // default per_page of our calls
  }
  return out;
}

/** A job's raw output as text: `gh()` only returns JSON, and a log is not JSON.
 *
 *  `/actions/jobs/:id/logs` answers 302 to a storage blob; `fetch` follows it and undici drops the
 *  `authorization` header on origin change, which is exactly right (the blob URL carries its own
 *  signature and refuses a second authentication).
 *
 *  `null` rather than an exception: a token without `actions:read` gets 403, an expired log 404, and
 *  neither justifies cancelling what the caller wanted. */
async function ghText(token: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "legion",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Check-run conclusions that are failures. `cancelled`, `skipped` and `neutral` are not: a cancelled
 *  job says nothing about the code, and sending an agent there would make it look for a cause that does
 *  not exist. `action_required` is one: CI waits for an action nobody will take. */
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

/** The job id for its logs, read from `details_url` (`.../actions/runs/<run>/job/<job>`).
 *
 *  The check-run id is not the Actions job id: `/actions/jobs/<id>/logs` answers 404 given the former.
 *  GitHub returns the latter nowhere else in this response, only in the URL. Falls back to the check-run
 *  id when the URL has another shape (a third-party app check, whose logs we would not read anyway). */
function jobIdOfCheckRun(run: Record<string, unknown>): string {
  return /\/job\/(\d+)/.exec(String(run.details_url ?? ""))?.[1] ?? String(run.id ?? "");
}

/** The verdict from the branch head's check runs. Pure: the rule, not the call.
 *
 *  No check run means `"unknown"`, never `"passing"`: a repository using only legacy commit statuses has
 *  none, and neither does a token without rights. See `CheckState`. */
export function checksReportOfRuns(runs: Record<string, unknown>[]): ChecksReport {
  if (runs.length === 0) return { state: CHECK_STATE.unknown, failing: [] };
  const failing: FailingCheck[] = runs
    .filter((r) => r.status === "completed" && FAILED_CONCLUSIONS.has(String(r.conclusion ?? "")))
    .map((r) => ({
      id: jobIdOfCheckRun(r),
      name: String(r.name ?? "?"),
      url: String(r.html_url ?? r.details_url ?? ""),
    }));
  if (failing.length > 0) return { state: CHECK_STATE.failing, failing };
  if (runs.some((r) => r.status !== "completed"))
    return { state: CHECK_STATE.pending, failing: [] };
  return { state: CHECK_STATE.passing, failing: [] };
}

/** In demo mode CI is red, the same choice as `mergeState: "conflict"` below: it exercises the fix-CI
 *  action without a real GitHub token. */
const FAKE_CHECKS: ChecksReport = {
  state: CHECK_STATE.failing,
  failing: [
    {
      id: "102031171336",
      name: "tests (node 20)",
      url: "https://github.com/mock/front/actions/runs/1/job/102031171336",
    },
  ],
};

const FAKE_JOB_LOG = [
  "2026-09-08T10:11:02.4Z ##[group]Run pnpm test",
  "2026-09-08T10:11:44.1Z FAIL src/report.test.tsx > Report > shows a spinner while data is missing",
  "2026-09-08T10:11:44.1Z AssertionError: expected null to be a Spinner element",
  "2026-09-08T10:11:44.2Z ##[error]Process completed with exit code 1.",
].join("\n");

/** In demo mode, two reachable repositories (one public, one private): exercises the picker without a
 *  real token (the list, the "already declared" mark, and the short name derived from the full path). */
const FAKE_CANDIDATES: ForgeRepoCandidate[] = [
  {
    fullName: "mock/front",
    url: "https://github.com/mock/front.git",
    private: false,
  },
  {
    fullName: "mock/back",
    url: "https://github.com/mock/back.git",
    private: true,
  },
];

const FAKE_DIFF: DiffFile[] = [
  {
    path: "src/report.tsx",
    status: "modified",
    additions: 3,
    deletions: 1,
    patch:
      "@@ -10,4 +10,6 @@ export function Report() {\n   const data = useReport();\n-  return <div>{data.total}</div>;\n+  if (!data) return <Spinner />;\n+  // the total is rounded on the server\n+  return <div>{data.total}</div>;\n   }",
  },
];

const FAKE_PRS: OpenChangeRequest[] = [
  {
    repo: "front",
    number: 7,
    title: "feat: PDF export of reports",
    url: "https://github.com/mock/front/pull/7",
    // "conflict" in demo mode exercises the resolve-conflicts action without a real GitHub token;
    // otherwise that path would only show in a story or for real.
    branch: "legion/mock-run",
    mergeState: "conflict",
    comments: [
      {
        id: "c1",
        author: "operator",
        body: "The button should be disabled while generating.",
        path: "src/Report.tsx",
        url: "https://github.com/mock/front/pull/7#c1",
        createdAt: new Date(0).toISOString(),
      },
      {
        id: "c2",
        author: "operator",
        body: "Missing a test for the empty report case.",
        path: null,
        url: "https://github.com/mock/front/pull/7#c2",
        createdAt: new Date(0).toISOString(),
      },
    ],
  },
];

/** Two deliberately different styles: demo mode must show what the read is for, that the position of the
 *  issue identifier varies between repositories. */
const FAKE_MERGED_TITLES = [
  "refactor: build the Historical check analysis cards on the DS Card (AI-2142)",
  "feat(integrations): AI-2109 expose a market category on the provider manifest",
];

/** A PR's comments in writing order. Two sources, both counting: code review (`/pulls/:n/comments`) and
 *  discussion (`/issues/:n/comments`). GitHub serves them on two paths, and the agent rereading its
 *  review reads them as one conversation. */
async function prComments(token: string, base: string, number: number): Promise<ForgeComment[]> {
  const comments: ForgeComment[] = [];
  for (const path of [
    `${base}/pulls/${number}/comments?per_page=30`,
    `${base}/issues/${number}/comments?per_page=30`,
  ]) {
    for (const cm of await ghList(token, path))
      comments.push({
        id: String(cm.id),
        author: String((cm.user as Record<string, unknown>)?.login ?? "?"),
        body: String(cm.body ?? ""),
        path: cm.path ? String(cm.path) : null,
        url: String(cm.html_url ?? ""),
        createdAt: String(cm.created_at ?? ""),
      });
  }
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const adapter: ForgeAdapter = {
  kind: "github",
  changeRequestLabel: "pull request",

  projectPath(url) {
    // No fallback to the shared grammar: `api.github.com` is constant here, so accepting
    // `gitlab.com/kopee/api` (two segments) would unlock no GitHub Enterprise and only replace
    // "non-GitHub URL", which says what to fix, with "repository unreachable (404)".
    const parsed = parseGitHubUrl(url);
    return parsed ? `${parsed.owner}/${parsed.repo}` : null;
  },

  async compareBranch(token, repo, branch): Promise<RepoDiff> {
    if (process.env.LEGION_GITHUB_FAKE === "1")
      return { repo: repo.name, branch, files: FAKE_DIFF, error: null };
    const path = adapter.projectPath(repo.url);
    if (!path)
      return { repo: repo.name, branch, files: null, error: `URL non-GitHub (${repo.url})` };
    const base = `/repos/${path}`;
    try {
      const repoInfo = await gh(token, "GET", base);
      if (repoInfo.status !== 200)
        return {
          repo: repo.name,
          branch,
          files: null,
          error: `repo unreachable (${repoInfo.status})`,
        };
      const defaultBranch = String(repoInfo.json.default_branch ?? "main");
      const cmp = await gh(
        token,
        "GET",
        `${base}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}`,
      );
      if (cmp.status === 404) return { repo: repo.name, branch, files: null, error: null }; // branch never pushed here
      if (cmp.status !== 200)
        return {
          repo: repo.name,
          branch,
          files: null,
          error: `compare ${cmp.status} — ${String(cmp.json.message ?? "").slice(0, 160)}`,
        };
      const files = (Array.isArray(cmp.json.files) ? cmp.json.files : []) as Record<
        string,
        unknown
      >[];
      return {
        repo: repo.name,
        branch,
        error: null,
        files: files.map((f) => ({
          path: String(f.filename ?? "?"),
          status: String(f.status ?? "modified"),
          additions: Number(f.additions ?? 0),
          deletions: Number(f.deletions ?? 0),
          patch: typeof f.patch === "string" ? f.patch : null, // omis par GitHub : binaire / trop gros
        })),
      };
    } catch (e) {
      return {
        repo: repo.name,
        branch,
        files: null,
        error: String((e as Error).message).slice(0, 200),
      };
    }
  },

  async listOpen(token, repo): Promise<OpenChangeRequest[]> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return FAKE_PRS;
    const path = adapter.projectPath(repo.url);
    if (!path) return [];
    const base = `/repos/${path}`;
    const out: OpenChangeRequest[] = [];
    for (const pr of await ghList(token, `${base}/pulls?state=open&per_page=30`)) {
      const branch = String((pr.head as Record<string, unknown>)?.ref ?? "");
      if (!branch.startsWith("legion/")) continue;
      const number = Number(pr.number);
      const comments = await prComments(token, base, number);
      // `mergeable` exists only when reading one PR (`GET /pulls/:n`); the list does not return it.
      // One more call per open PR, next to the two reading its comments: the price of on demand, not a
      // background poller.
      const mergeState = await adapter.mergeState(token, repo, number);
      out.push({
        repo: repo.name,
        number,
        title: String(pr.title ?? ""),
        url: String(pr.html_url ?? ""),
        branch,
        comments,
        mergeState,
      });
    }
    return out;
  },

  async mergeState(token, repo, number): Promise<MergeState> {
    if (process.env.LEGION_GITHUB_FAKE === "1")
      return FAKE_PRS.find((pr) => pr.number === number)?.mergeState ?? "unknown";
    const path = adapter.projectPath(repo.url);
    if (!path) return "unknown";
    const res = await gh(token, "GET", `/repos/${path}/pulls/${number}`);
    if (res.status !== 200) return "unknown";
    // GitHub computes `mergeable` in the background: `null` while it runs (the docs say "you should
    // check back later"), `true`/`false` once done. Mapping `null` to mergeable would lie about a
    // computation still running; return `"unknown"` and let the caller retry on the next look.
    const mergeable = res.json.mergeable;
    if (mergeable === true) return "mergeable";
    if (mergeable === false) return "conflict";
    return "unknown";
  },

  async checks(token, repo, number): Promise<ChecksReport> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return FAKE_CHECKS;
    const path = adapter.projectPath(repo.url);
    if (!path) return { state: CHECK_STATE.unknown, failing: [] };
    // Two calls, the first unavoidable: check runs attach to a commit, and only the PR says which one is
    // its head right now (a branch pushed meanwhile moves the answer, which is what we want to reread
    // at click time).
    const pr = await gh(token, "GET", `/repos/${path}/pulls/${number}`);
    if (pr.status !== 200) return { state: CHECK_STATE.unknown, failing: [] };
    const sha = String((pr.json.head as Record<string, unknown>)?.sha ?? "");
    if (!sha) return { state: CHECK_STATE.unknown, failing: [] };
    const res = await gh(
      token,
      "GET",
      `/repos/${path}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
    );
    if (res.status !== 200) return { state: CHECK_STATE.unknown, failing: [] };
    const runs = res.json.check_runs;
    return checksReportOfRuns(Array.isArray(runs) ? (runs as Record<string, unknown>[]) : []);
  },

  async checkLog(token, _repo, checkId): Promise<string | null> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return FAKE_JOB_LOG;
    const path = adapter.projectPath(_repo.url);
    if (!path || !/^\d+$/.test(checkId)) return null;
    // `actions:read` is the only prerequisite of this batch an existing token may lack: without it
    // GitHub answers 403 and `ghText` returns `null`. The caller continues with the job name and URL
    // (see `fix-ci.ts`, which says so in the brief rather than giving up).
    return ghText(token, `/repos/${path}/actions/jobs/${checkId}/logs`);
  },

  async mergeStateWithPrState(
    token,
    repo,
    number,
  ): Promise<{ mergeState: MergeState; prState: "open" | "merged" | "closed" }> {
    if (process.env.LEGION_GITHUB_FAKE === "1") {
      const fake = FAKE_PRS.find((pr) => pr.number === number);
      return { mergeState: fake?.mergeState ?? "unknown", prState: "open" };
    }
    const path = adapter.projectPath(repo.url);
    if (!path) return { mergeState: "unknown", prState: "closed" };
    const res = await gh(token, "GET", `/repos/${path}/pulls/${number}`);
    if (res.status !== 200) return { mergeState: "unknown", prState: "closed" };

    const state: "open" | "merged" | "closed" = res.json.merged_at
      ? "merged"
      : res.json.state === "closed"
        ? "closed"
        : "open";

    const mergeable = res.json.mergeable;
    const mergeState: MergeState =
      mergeable === true ? "mergeable" : mergeable === false ? "conflict" : "unknown";

    return { mergeState, prState: state };
  },

  async listMergedTitles(token, repo): Promise<string[]> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return FAKE_MERGED_TITLES;
    const path = adapter.projectPath(repo.url);
    if (!path) return [];
    // `state=closed` sorted by update date descending: GitHub has no `state=merged`, and a PR closed
    // without merging was not validated by the repository's CI, so its title teaches nothing. Hence the
    // filter on `merged_at`, the only discriminant the API gives.
    const res = await gh(
      token,
      "GET",
      `/repos/${path}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    );
    if (res.status !== 200 || !Array.isArray(res.json))
      throw new Error(`GitHub refused to read the merged PRs (${res.status})`);
    return (res.json as unknown as Record<string, unknown>[])
      .filter((pr) => typeof pr.merged_at === "string")
      .map((pr) => String(pr.title ?? ""));
  },

  async getTokenOwnerLogin(token): Promise<string | null> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return "mock-user";
    try {
      const res = await gh(token, "GET", "/user");
      if (res.status === 200)
        return typeof res.json.login === "string" && res.json.login ? res.json.login : null;
    } catch {
      // Network or parse error: return null
    }
    return null;
  },

  async listVerifiedEmails(token): Promise<VerifiedEmail[] | null> {
    if (process.env.LEGION_GITHUB_FAKE === "1")
      return [{ email: "mock-user@example.com", primary: true }];
    // `/user/emails` needs the `user:email` scope. A token without it answers 403/404: "unknown"
    // (null), not an empty list. A PAT limited to repositories is legitimate, and the check must stay
    // silent rather than accuse wrongly.
    try {
      const res = await gh(token, "GET", "/user/emails");
      if (res.status !== 200 || !Array.isArray(res.json)) return null;
      return (res.json as unknown as Record<string, unknown>[])
        .filter((e) => e.verified === true && typeof e.email === "string")
        .map((e) => ({ email: String(e.email), primary: e.primary === true }));
    } catch {
      return null;
    }
  },

  // `instanceHost` is not read here, deliberately: `gh()` talks to `api.github.com`, a constant, and
  // the GitHub tile asks for no field, so the resolved host is always `github.com`. Enterprise would
  // need much more than a host (another API root, another repository URL grammar).
  async listRepos(token, _instanceHost): Promise<ForgeRepoCandidate[] | null> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return FAKE_CANDIDATES;
    // Its own loop, not `ghList`: `ghList` returns `[]` both for a refused token and for an account
    // with no repositories, the confusion `null` exists to avoid. Refusal is read on the first page;
    // after it, return what we have (a later failing page truncates, it does not erase).
    //
    // `affiliation` names the three memberships rather than relying on the default: without it,
    // repositories one is only an organisation member of are missing. It cannot bring back those of an
    // organisation restricting third-party apps; they vanish without error, and the UI says so.
    const base =
      "/user/repos?affiliation=owner,collaborator,organization_member" +
      `&sort=full_name&per_page=${FORGE_DISCOVERY_PER_PAGE}`;
    const out: ForgeRepoCandidate[] = [];
    try {
      for (let page = 1; page <= FORGE_DISCOVERY_PAGES; page++) {
        // The timeout is per page, which is why it is here rather than around the whole call: outside,
        // it wrapped all three pages and threw away the partial result promised below.
        const res = await withForgeTimeout(`reading the repos (page ${page})`, () =>
          gh(token, "GET", `${base}&page=${page}`),
        );
        if (res.status !== 200 || !Array.isArray(res.json)) return page === 1 ? null : out;
        // `Array.isArray` is enough to narrow: no `as unknown as` added to a file already carrying four.
        const items: Record<string, unknown>[] = res.json;
        for (const r of items) {
          const url = String(r.clone_url ?? "");
          const fullName = String(r.full_name ?? "");
          if (!url || !fullName) continue;
          out.push({
            fullName,
            url,
            private: r.private === true,
          });
        }
        if (items.length < FORGE_DISCOVERY_PER_PAGE) break;
      }
    } catch {
      return out.length > 0 ? out : null;
    }
    return out;
  },

  async assignChangeRequest(token, repo, number, login): Promise<boolean> {
    if (process.env.LEGION_GITHUB_FAKE === "1") return true;
    const path = adapter.projectPath(repo.url);
    if (!path) return false;
    try {
      const res = await gh(token, "POST", `/repos/${path}/issues/${number}/assignees`, {
        assignees: [login],
      });
      // GitHub returns 201 on success
      return res.status === 201;
    } catch {
      return false;
    }
  },

  async createRepoHook(token, repo, opts): Promise<RepoHookResult> {
    if (process.env.LEGION_GITHUB_FAKE === "1")
      return { ok: true, id: "hook-fake-1", existing: false };
    const path = adapter.projectPath(repo.url);
    if (!path) return { ok: false, error: `URL non-GitHub (${repo.url})` };
    try {
      // Idempotence by reading first: GitHub refuses a duplicate with 422, but its message does not
      // return the existing hook id, which would require listing anyway. Listing first keeps one output
      // grammar.
      const existing = await gh(token, "GET", `/repos/${path}/hooks?per_page=100`);
      if (existing.status === 200 && Array.isArray(existing.json)) {
        const hit = (existing.json as unknown as Record<string, unknown>[]).find(
          (h) => String((h.config as Record<string, unknown>)?.url ?? "") === opts.url,
        );
        if (hit) return { ok: true, id: String(hit.id), existing: true };
      }
      const created = await gh(token, "POST", `/repos/${path}/hooks`, {
        name: "web",
        active: true,
        // `pull_request` only: the event the server knows what to do with. A hook subscribed to
        // everything would send every signed push to the gate for nothing.
        events: ["pull_request"],
        config: { url: opts.url, content_type: "json", secret: opts.secret },
      });
      if (created.status === 201) return { ok: true, id: String(created.json.id), existing: false };
      // 404 means a token without admin:repo_hook on this repository: GitHub hides existence rather
      // than admit missing rights. Saying so saves an hour of false leads.
      if (created.status === 404)
        return {
          ok: false,
          error:
            "hooks unreachable (404) — the token probably lacks the admin:repo_hook right on this repo",
        };
      return {
        ok: false,
        error: `${created.status} — ${String(created.json.message ?? "").slice(0, 200)}`,
      };
    } catch (e) {
      return { ok: false, error: String((e as Error).message).slice(0, 200) };
    }
  },

  async create(token, repo, opts): Promise<CreateResult> {
    const path = adapter.projectPath(repo.url);
    if (!path) return { ok: false, error: `URL non-GitHub (${repo.url})` };
    // The token is already resolved here; what remains useful to say is the expected scope, the only
    // actionable part of the old global message.
    const base = `/repos/${path}`;
    const owner = path.split("/")[0]!;
    try {
      const repoInfo = await gh(token, "GET", base);
      if (repoInfo.status !== 200)
        return { ok: false, error: `repo unreachable (${repoInfo.status})` };
      const defaultBranch = String(repoInfo.json.default_branch ?? "main");
      const created = await gh(token, "POST", `${base}/pulls`, {
        title: opts.title,
        head: opts.branch,
        base: defaultBranch,
        body: opts.body,
      });
      if (created.status === 201)
        return { ok: true, url: String(created.json.html_url), existing: false };
      if (created.status === 422) {
        // PR already open for this branch: find it (idempotence). state=open: never return an old
        // closed or merged PR as "existing" (night review #6).
        const existing = await gh(
          token,
          "GET",
          `${base}/pulls?head=${owner}:${encodeURIComponent(opts.branch)}&state=open`,
        );
        const first = Array.isArray(existing.json)
          ? (existing.json[0] as Record<string, unknown> | undefined)
          : undefined;
        if (first?.html_url) return { ok: true, url: String(first.html_url), existing: true };
        return {
          ok: false,
          error: `422 — ${JSON.stringify(created.json.errors ?? created.json.message).slice(0, 200)}`,
        };
      }
      return {
        ok: false,
        error: `${created.status} — ${String(created.json.message ?? "").slice(0, 200)}`,
      };
    } catch (e) {
      return { ok: false, error: String((e as Error).message).slice(0, 200) };
    }
  },
};

registerForge(adapter);
export const githubForge: ForgeAdapter = adapter;

/** Compatibility re-exports: the port types lost the "Pr" prefix (one forge out of two says "merge
 *  request"), but the web side still uses the old names. */
export type { DiffFile, ForgeRepo, OpenChangeRequest, RepoDiff };
