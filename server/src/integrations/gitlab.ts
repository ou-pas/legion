// GitLab adapter of the `forge.ts` port. API v4, token sent in the `PRIVATE-TOKEN` header (the only form
// accepting a personal PAT, a project token and a group token alike; the group token is what makes a
// multi-repository project possible with one secret).
//
// Written without touching a real GitLab. Endpoints and field names come from the v4 API docs, checked
// on 26/08; nothing was exercised against an instance. The first real run will fix what needs fixing;
// what matters is that the path exists and push no longer depends on any of this.
//
// Three structural differences from GitHub:
//
//  1. Nested groups. `group/subgroup/project` is legal and GitHub's `owner`/`repo` pair cannot represent
//     it, hence the port's opaque path, URL-encoded whole here (`group%2Fsubgroup%2Fproject`) as v4
//     requires.
//  2. The host is not fixed. `api.github.com` is a constant; the GitLab API lives on the repository's
//     own host (`https://<host>/api/v4`). That makes a self-hosted instance work with no extra line, and
//     is why the forge is declared on the repository rather than guessed from `gitlab.com`.
//  3. No per-file line counts. `/repository/compare` returns diff text and flags (`new_file`,
//     `deleted_file`, `renamed_file`, `too_large`), never `additions`/`deletions`. They are computed
//     (`countDiffLines`) rather than shown as 0: two adapters filling one field differently would make
//     two screens meaning different things.
import {
  CHECK_STATE,
  countDiffLines,
  FORGE_DISCOVERY_PAGES,
  forgeInstanceHost,
  FORGE_DISCOVERY_PER_PAGE,
  hostOfRepoUrl,
  pathOfRepoUrl,
  registerForge,
  withForgeTimeout,
  type CheckState,
  type ChecksReport,
  type CreateResult,
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

/** The API root for this repository, derived from its host, self-hosted included. */
function apiBase(repo: ForgeRepo): string | null {
  // An instance's API lives on the same host as the repository, readable in both URL grammars (v40):
  // `git@gitlab.com:o/r.git` designates the same instance as its https form. The API is always called
  // over https; only how the repository is reached varies.
  if (/^http:\/\//i.test(repo.url.trim())) return null; // no calls in clear
  const host = hostOfRepoUrl(repo.url);
  return host ? `https://${host}/api/v4` : null;
}

/** The API root of an instance designated by its host, for reads starting from a token rather than a
 *  repository, where no URL says whom we talk to.
 *
 *  A bare host (`framagit.org`), not a URL. The connection tile asks the operator for a URL
 *  (`connections/gitlab-device.ts`: "GitLab instance URL", suggestion `https://gitlab.com`), and a URL
 *  is what `metadata.fields.host` stores. The conversion has one place, `forgeInstanceHost`, which
 *  strips scheme and trailing slash and is tested on both forms. Passing the URL here directly makes
 *  `https://https://framagit.org/api/v4`, a call failing silently (seen in review on 16/09). Every caller
 *  goes through `forgeInstanceHost`. */
function instanceBase(host: string): string {
  return `https://${host}/api/v4`;
}

/** A GitLab instance and the token opening it. They never separate (an instance's token is worthless
 *  on another), and grouping them avoids passing five positions on every call. */
interface GlApi {
  base: string;
  token: string;
}

async function gl(
  api: GlApi,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${api.base}${path}`, {
    method,
    headers: {
      "private-token": api.token,
      accept: "application/json",
      "user-agent": "legion",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Paginated GET, same cap as the GitHub adapter: stop cleanly rather than silently truncate on one
 *  more page. */
async function glList(
  token: string,
  base: string,
  path: string,
  maxPages = 3,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await gl({ base, token }, "GET", `${path}${sep}page=${page}&per_page=30`);
    // A refusal is not an empty list. A token without the `api` scope, expired, or rate-limited returned
    // `[]`, and the UI showed "no open request" forever: the worst answer, reassuring and false. The
    // GitHub adapter has its quota guard (`rateLeft`); this is GitLab's.
    if (res.status === 401 || res.status === 403 || res.status === 429)
      throw new Error(
        `GitLab refused the read (${res.status}) — token missing, without the api scope, expired, or rate limit reached`,
      );
    if (res.status !== 200 || !Array.isArray(res.json)) break;
    const items = res.json as Record<string, unknown>[];
    out.push(...items);
    if (items.length < 30) break;
  }
  return out;
}

/** GitLab's error message, sometimes a string and sometimes an object of fields
 *  (`{"message":{"source_branch":["can't be blank"]}}`). `String()` alone gave "[object Object]". */
function glMessage(json: unknown): string {
  const body = (json ?? {}) as Record<string, unknown>;
  const raw = body.message ?? body.error ?? "";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/** A file's status in the vocabulary shared by both forges (GitHub's, already the UI's): GitLab only
 *  exposes boolean flags. */
function statusOf(d: Record<string, unknown>): string {
  if (d.new_file === true) return "added";
  if (d.deleted_file === true) return "removed";
  if (d.renamed_file === true) return "renamed";
  return "modified";
}

/** The merge state, read on the MR object already in hand. GitLab returns it on list and detail alike
 *  (unlike GitHub, detail only, hence `mergeState()` below rereading one MR when only its number is
 *  known).
 *
 *  GitLab exposes two fields: `merge_status` (legacy, three values) and `detailed_merge_status` (v15.6+,
 *  a dozen states with only `"mergeable"` positive). The second's full state machine is not built
 *  (unverified against a real GitLab, and the need is binary: mergeable or conflict). The first field,
 *  always present, is read, and everything else (check in progress, token without rights, unknown value)
 *  falls back to `"unknown"`, never `"mergeable"`. */
function mergeStateOf(mr: Record<string, unknown>): MergeState {
  const status = String(mr.merge_status ?? "");
  if (status === "can_be_merged") return "mergeable";
  if (status === "cannot_be_merged" || status === "cannot_be_merged_recheck") return "conflict";
  return "unknown";
}

/** The CI verdict from the MR's latest pipeline status. Pure: the rule.
 *
 *  `canceled`, `skipped` and `manual` fall back to `"unknown"`, never `"passing"`: a cancelled pipeline or
 *  one waiting for a human said nothing about the code. Everything else (`created`, `pending`, `running`,
 *  `preparing`, `waiting_for_resource`, `scheduled`) is waiting. */
const PIPELINE_VERDICT: Record<string, CheckState> = {
  success: CHECK_STATE.passing,
  failed: CHECK_STATE.failing,
  canceled: CHECK_STATE.unknown,
  skipped: CHECK_STATE.unknown,
  manual: CHECK_STATE.unknown,
};

export function checkStateOfPipelineStatus(status: string): CheckState {
  return PIPELINE_VERDICT[status] ?? (status ? CHECK_STATE.pending : CHECK_STATE.unknown);
}

/** A job's trace as text: `gl()` only returns JSON, and `/trace` returns raw text. `null` covers every
 *  refusal, as on GitHub: a token without job rights must not cancel what the caller wanted. */
async function glText(token: string, base: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "private-token": token, accept: "text/plain", "user-agent": "legion" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** An MR's human comments in writing order. System notes ("assigned", "pushed 3 commits") are not
 *  comments: passing them to the agent would drown the real review in log noise. */
async function mrComments(
  token: string,
  project: { base: string; id: string },
  iid: number,
  webUrl: string,
): Promise<ForgeComment[]> {
  const comments: ForgeComment[] = [];
  for (const note of await glList(
    token,
    project.base,
    `/projects/${project.id}/merge_requests/${iid}/notes?sort=asc`,
  )) {
    if (note.system === true) continue;
    const position = note.position as Record<string, unknown> | undefined;
    comments.push({
      id: String(note.id),
      author: String((note.author as Record<string, unknown>)?.username ?? "?"),
      body: String(note.body ?? ""),
      path: position?.new_path ? String(position.new_path) : null,
      // GitLab returns no URL per note: it is built from the MR's, in a form its web UI understands.
      url: webUrl ? `${webUrl}#note_${String(note.id)}` : "",
      createdAt: String(note.created_at ?? ""),
    });
  }
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const adapter: ForgeAdapter = {
  kind: "gitlab",
  changeRequestLabel: "merge request",

  projectPath(url) {
    const path = pathOfRepoUrl(url);
    // At least two segments: `group/project`. One segment is not a GitLab project.
    return path && path.includes("/") ? path : null;
  },

  async compareBranch(token, repo, branch): Promise<RepoDiff> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path)
      return { repo: repo.name, branch, files: null, error: `unreadable GitLab URL (${repo.url})` };
    const id = encodeURIComponent(path);
    try {
      const info = await gl({ base, token }, "GET", `/projects/${id}`);
      if (info.status !== 200)
        return {
          repo: repo.name,
          branch,
          files: null,
          error: `project unreachable (${info.status})`,
        };
      const defaultBranch = String((info.json as Record<string, unknown>).default_branch ?? "main");
      const cmp = await gl(
        { base, token },
        "GET",
        `/projects/${id}/repository/compare?from=${encodeURIComponent(defaultBranch)}&to=${encodeURIComponent(branch)}`,
      );
      // Branch never pushed here: information, not an error. Same meaning as GitHub's `compare` 404.
      if (cmp.status === 404) return { repo: repo.name, branch, files: null, error: null };
      if (cmp.status !== 200)
        return {
          repo: repo.name,
          branch,
          files: null,
          error: `compare ${cmp.status} — ${glMessage(cmp.json).slice(0, 160)}`,
        };
      const body = cmp.json as Record<string, unknown>;
      const diffs = (body.diffs ?? []) as Record<string, unknown>[];
      return {
        repo: repo.name,
        branch,
        // `compare_timeout`: GitLab itself says the list is incomplete. Returning `error: null` would
        // present a truncated diff as whole, the same lie `patch: null` avoids per file.
        error:
          body.compare_timeout === true
            ? "comparison interrupted on GitLab's side (compare_timeout) — the file list is incomplete"
            : null,
        files: (Array.isArray(diffs) ? diffs : []).map((d) => {
          // `too_large` / `collapsed`: GitLab sends no text. Same as GitHub's omitted `patch`: return
          // `null`, and the UI says it does not know.
          const patch =
            d.too_large === true || d.collapsed === true || typeof d.diff !== "string"
              ? null
              : String(d.diff);
          const { additions, deletions } = countDiffLines(patch);
          return {
            path: String(d.new_path ?? d.old_path ?? "?"),
            status: statusOf(d),
            additions,
            deletions,
            patch,
          };
        }),
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
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return [];
    const id = encodeURIComponent(path);
    const out: OpenChangeRequest[] = [];
    for (const mr of await glList(token, base, `/projects/${id}/merge_requests?state=opened`)) {
      const branch = String(mr.source_branch ?? "");
      if (!branch.startsWith("legion/")) continue;
      const iid = Number(mr.iid);
      const webUrl = String(mr.web_url ?? "");
      const comments = await mrComments(token, { base, id }, iid, webUrl);
      out.push({
        repo: repo.name,
        number: iid,
        title: String(mr.title ?? ""),
        url: webUrl,
        branch,
        comments,
        mergeState: mergeStateOf(mr),
      });
    }
    return out;
  },

  async mergeState(token, repo, number): Promise<MergeState> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return "unknown";
    const res = await gl(
      { base, token },
      "GET",
      `/projects/${encodeURIComponent(path)}/merge_requests/${number}`,
    );
    if (res.status !== 200) return "unknown";
    return mergeStateOf(res.json as Record<string, unknown>);
  },

  async checks(token, repo, number): Promise<ChecksReport> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return { state: CHECK_STATE.unknown, failing: [] };
    const id = encodeURIComponent(path);
    // An MR's pipelines, newest first (GitLab sorts by descending id). The newest carries the verdict;
    // earlier ones are the branch's history, not its state.
    const res = await gl(
      { base, token },
      "GET",
      `/projects/${id}/merge_requests/${number}/pipelines?per_page=1`,
    );
    if (res.status !== 200 || !Array.isArray(res.json))
      return { state: CHECK_STATE.unknown, failing: [] };
    const latest = (res.json as Record<string, unknown>[])[0];
    if (!latest) return { state: CHECK_STATE.unknown, failing: [] };
    const state = checkStateOfPipelineStatus(String(latest.status ?? ""));
    if (state !== CHECK_STATE.failing) return { state, failing: [] };
    // One page of red jobs: something to act on, not an inventory.
    const jobs = await gl(
      { base, token },
      "GET",
      `/projects/${id}/pipelines/${Number(latest.id)}/jobs?scope[]=failed&per_page=30`,
    );
    const rows =
      jobs.status === 200 && Array.isArray(jobs.json)
        ? (jobs.json as Record<string, unknown>[])
        : [];
    return {
      state,
      failing: rows.map((j) => ({
        id: String(j.id ?? ""),
        name: String(j.name ?? "?"),
        url: String(j.web_url ?? ""),
      })),
    };
  },

  async checkLog(token, repo, checkId): Promise<string | null> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path || !/^\d+$/.test(checkId)) return null;
    return glText(token, base, `/projects/${encodeURIComponent(path)}/jobs/${checkId}/trace`);
  },

  async mergeStateWithPrState(
    token,
    repo,
    number,
  ): Promise<{ mergeState: MergeState; prState: "open" | "merged" | "closed" }> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return { mergeState: "unknown", prState: "closed" };
    const res = await gl(
      { base, token },
      "GET",
      `/projects/${encodeURIComponent(path)}/merge_requests/${number}`,
    );
    if (res.status !== 200) return { mergeState: "unknown", prState: "closed" };

    const data = res.json as Record<string, unknown>;
    // GitLab state can be "opened", "closed", "merged", "locked".
    const glState = String(data.state ?? "");
    const prState: "open" | "merged" | "closed" =
      glState === "merged" ? "merged" : glState === "closed" ? "closed" : "open";

    const mergeState = mergeStateOf(data);

    return { mergeState, prState };
  },

  async listMergedTitles(token, repo): Promise<string[]> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return [];
    // `state=merged` exists here, unlike GitHub: no filtering afterwards. `glList` with `maxPages = 1`
    // (a style, not an inventory) carries the refusal guard (401/403/429), so silence does not pass for
    // a repository without convention.
    const path_ = `/projects/${encodeURIComponent(path)}/merge_requests?state=merged&order_by=updated_at&sort=desc`;
    return (await glList(token, base, path_, 1)).map((mr) => String(mr.title ?? ""));
  },

  async listVerifiedEmails(): Promise<VerifiedEmail[] | null> {
    // GitLab exposes `/user/emails` but without a verification flag, so the question ("will this address
    // be attached to the account?") cannot be answered, and an unverified list presented as verified
    // would be worse than no check. `null` means unknown, which callers handle.
    return null;
  },

  async listRepos(token, instanceHost): Promise<ForgeRepoCandidate[] | null> {
    // Its own loop, not `glList`, as on GitHub: `glList` throws on refusal and returns `[]` otherwise,
    // while "refused" versus "no repositories" is this method's whole contract.
    const base = instanceBase(instanceHost);
    const out: ForgeRepoCandidate[] = [];
    try {
      for (let page = 1; page <= FORGE_DISCOVERY_PAGES; page++) {
        // The timeout is per page, as on GitHub: around the whole call it threw away the partial result
        // promised below.
        const res = await withForgeTimeout(`reading the repos (page ${page})`, () =>
          gl(
            { base, token },
            "GET",
            `/projects?membership=true&order_by=path&sort=asc&per_page=${FORGE_DISCOVERY_PER_PAGE}&page=${page}`,
          ),
        );
        if (res.status !== 200 || !Array.isArray(res.json)) return page === 1 ? null : out;
        const items: Record<string, unknown>[] = res.json;
        for (const p of items) {
          const url = String(p.http_url_to_repo ?? "");
          const fullName = String(p.path_with_namespace ?? "");
          if (!url || !fullName) continue;
          out.push({
            fullName,
            url,
            // `visibility` is "private", "internal" or "public". Anything not public is private for the
            // UI: "internal" is an instance nuance adding a repository does not depend on.
            private: p.visibility !== "public",
          });
        }
        if (items.length < FORGE_DISCOVERY_PER_PAGE) break;
      }
    } catch {
      return out.length > 0 ? out : null;
    }
    return out;
  },

  async getTokenOwnerLogin(token): Promise<string | null> {
    // This one takes no host, and it shows in the UI: a known, unfixed defect, named here and in
    // `projects/git-identity-check.ts` (round 2, another task's scope).
    //
    // Effect: a project on a self-hosted instance (framagit, an internal GitLab) sends this read to
    // `gitlab.com`, where its token is worthless. The login is `null` and `checkProjectGitIdentity`
    // returns "unknown", permanently, so the project card always says it cannot tell whether commits
    // will be attributed, on a perfectly configured project.
    //
    // Identity adoption escapes it: `listVerifiedEmails` always returns `null` on GitLab, so it never
    // sets anything on a GitLab connection. The check pays, not adoption.
    //
    // Not fixed here: the signature is shared by three callers, two of which already know a repository
    // (and read the host from its URL). Opening it means deciding what those two receive, a task of its
    // own. `listRepos` shows the way.
    const base = instanceBase(forgeInstanceHost("gitlab", null));
    try {
      const res = await gl({ base, token }, "GET", "/user");
      if (res.status === 200) {
        // GitLab returns `id` (numeric) and `username` (string); `username` is used.
        const username = (res.json as Record<string, unknown>).username;
        return typeof username === "string" && username ? username : null;
      }
    } catch {
      // Network or parse error: return null
    }
    return null;
  },

  async assignChangeRequest(_token, _repo, _number, _login): Promise<boolean> {
    // Not implemented: GitLab assigns by numeric `assignee_id`, not login, and there is no login → id
    // mapping here. Returns false rather than failing.
    return false;
  },

  async createRepoHook(token, repo, opts): Promise<RepoHookResult> {
    if (process.env.LEGION_GITHUB_FAKE === "1")
      return { ok: true, id: "hook-fake-1", existing: false };
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return { ok: false, error: `unreadable GitLab URL (${repo.url})` };
    const id = encodeURIComponent(path);
    try {
      // GitLab does not refuse duplicates: two identical POSTs make two hooks, each firing twice. Reading
      // first is the only guard.
      const existing = await glList(token, base, `/projects/${id}/hooks`, 1);
      const hit = existing.find((h) => String(h.url ?? "") === opts.url);
      if (hit) return { ok: true, id: String(hit.id), existing: true };
      const created = await gl({ base, token }, "POST", `/projects/${id}/hooks`, {
        url: opts.url,
        token: opts.secret,
        // MRs only, for the same reason as `pull_request` only on GitHub.
        merge_requests_events: true,
        push_events: false,
        enable_ssl_verification: true,
      });
      if (created.status === 201)
        return {
          ok: true,
          id: String((created.json as Record<string, unknown>).id),
          existing: false,
        };
      return { ok: false, error: `${created.status} — ${glMessage(created.json).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: String((e as Error).message).slice(0, 200) };
    }
  },

  async create(token, repo, opts): Promise<CreateResult> {
    const base = apiBase(repo);
    const path = adapter.projectPath(repo.url);
    if (!base || !path) return { ok: false, error: `unreadable GitLab URL (${repo.url})` };
    const id = encodeURIComponent(path);
    try {
      const info = await gl({ base, token }, "GET", `/projects/${id}`);
      if (info.status !== 200) return { ok: false, error: `project unreachable (${info.status})` };
      const defaultBranch = String((info.json as Record<string, unknown>).default_branch ?? "main");
      const created = await gl({ base, token }, "POST", `/projects/${id}/merge_requests`, {
        source_branch: opts.branch,
        target_branch: defaultBranch,
        title: opts.title,
        description: opts.body,
      });
      if (created.status === 201) {
        const url = String((created.json as Record<string, unknown>).web_url ?? "");
        if (url) return { ok: true, url, existing: false };
        return { ok: false, error: "MR created but no web_url in the response" };
      }
      // Failure: look for an MR already open on this branch before concluding. The conflict status code
      // is undocumented (409 in some versions, 400 with a message in others), so it is not relied on:
      // look at the world, not the return code. Same idempotence as GitHub's 422 path.
      const open = await glList(
        token,
        base,
        `/projects/${id}/merge_requests?state=opened&source_branch=${encodeURIComponent(opts.branch)}`,
        1,
      );
      const first = open[0];
      if (first?.web_url) return { ok: true, url: String(first.web_url), existing: true };
      return { ok: false, error: `${created.status} — ${glMessage(created.json).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: String((e as Error).message).slice(0, 200) };
    }
  },
};

registerForge(adapter);
export const gitlabForge: ForgeAdapter = adapter;
