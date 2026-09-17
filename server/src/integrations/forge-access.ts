// Forge composition: the only place knowing the database, secrets and adapters at once. Deliberate,
// the price of the adapters' humility: `github.ts` and `gitlab.ts` read nothing, decrypt nothing, and
// receive their token. All resolution (which repository, which forge, which secret) is here, once.
//
// Before 26/08 it lived inside the GitHub adapter (`githubToken(projectId)` plus a `db.select()` among
// API calls). A second adapter would have duplicated it, and testing required a real database.
//
// Both adapters are imported here and nowhere else, which registers them (`registerForge`). `forge.ts`
// imports no adapter, or the port would depend on its implementations.
import { repoRowsNamed, repoRowsOf } from "./integrations-store.js";
import { freshSecret, freshSecretWithField } from "../connections/secret-access.js";
import { HOST_FIELD as GITLAB_HOST_FIELD } from "../connections/gitlab-device.js";
import {
  CHECK_STATE,
  credentialFor,
  effectiveForge,
  FORGE_CALL_TIMEOUT_MS,
  FORGE_DISCOVERY_CAP,
  FORGE_DISCOVERY_PAGES,
  FORGE_KINDS,
  forgeInstanceHost,
  forgeFor,
  numberOfChangeRequestUrl,
  withForgeTimeout,
  type ChangeRequest,
  type CheckState,
  type ForgeAdapter,
  type ForgeKind,
  type ForgeRepo,
  type ForgeRepoCandidate,
  type MergeState,
  type OpenChangeRequest,
  type RepoDiff,
} from "./forge.js";
import "./github.js";
import "./gitlab.js";

/** In-memory cache of the token owner's login, per token (one call per process is enough). */
const tokenOwnerLoginCache = new Map<string, string | null>();

/** Clears the token login cache (for tests). */
export function clearTokenOwnerLoginCache(): void {
  tokenOwnerLoginCache.clear();
}

/** The read cap, inherited from the old code (`repos.slice(0, 10)` in `taskDiff` and `listAgentPrs`).
 *  It never existed for writes and must not appear now: a run pushing to eleven repositories must open
 *  eleven change requests.
 *
 *  What changes: truncation is no longer silent. `compareBranchOnRepos` adds a named error line, the
 *  same channel as failing repositories, already shown in the UI. */
export const FORGE_REPO_CAP = 10;

/** The GitHub demo flag, tested here before any secret resolution: its point is running the UI without
 *  a token. In the adapter (where it lived) it was unreachable once token resolution came first. */
function fakeMode(): boolean {
  return process.env.LEGION_GITHUB_FAKE === "1";
}

/** Finds the token owner's login (the project operator), cached in memory. */
async function getTokenOwnerLogin(adapter: ForgeAdapter, token: string): Promise<string | null> {
  if (tokenOwnerLoginCache.has(token)) {
    return tokenOwnerLoginCache.get(token) ?? null;
  }
  const login = await adapter.getTokenOwnerLogin(token);
  tokenOwnerLoginCache.set(token, login);
  return login;
}

/** A repository ready to query: its forge resolved and its token in hand. */
export type ResolvedRepo = { repo: ForgeRepo; adapter: ForgeAdapter; token: string };

/** What could not be resolved, named per repository, never silent. */
export type ForgeAccessError = { repo: string; error: string };

export type ForgeAccess = {
  resolved: ResolvedRepo[];
  errors: ForgeAccessError[];
  /** Repositories left out by the cap, usually 0. */
  truncated: number;
};

function tokenFor(projectId: string, kind: ForgeKind): string | null {
  const { secretName } = credentialFor(kind);
  return freshSecret(projectId, secretName);
}

/** Resolves a project's repositories (all, or the named ones) into queryable targets.
 *
 *  A missing token becomes a named error, not an exception: a project can mix two forges, and one
 *  missing secret must not prevent reading the other. The module's rule: a failing repository never
 *  hides the others. */
export function resolveForgeRepos(
  projectId: string,
  repoNames?: readonly string[],
  /** `Infinity` for calls that never had a cap (creating change requests). The cap protects costly
   *  read sweeps; applying it to writes would silently stop opening MRs on an eleven-repository project. */
  cap: number = FORGE_REPO_CAP,
): ForgeAccess {
  const rows = repoNames ? repoRowsNamed(projectId, repoNames) : repoRowsOf(projectId);

  const kept = Number.isFinite(cap) ? rows.slice(0, cap) : rows;
  const resolved: ResolvedRepo[] = [];
  const errors: ForgeAccessError[] = [];
  // One token per forge, not per repository: what makes a multi-repository project viable with one
  // secret (a GitLab group token covers every project of the group).
  const tokens = new Map<ForgeKind, string | null>();

  for (const row of kept) {
    // Undetermined forge (neither declared nor certain from the host): no guessing. Reading a
    // Bitbucket repository as GitHub would present it the GitHub PAT, which the runner's old filter
    // forbade.
    const kind = effectiveForge(row);
    if (!kind) {
      errors.push({ repo: row.name, error: `no forge declared for the host of ${row.url}` });
      continue;
    }
    // This resolution no longer reads `LEGION_FORGE_HOSTS` (08/09). It did from 05/09, at the cost of
    // well-configured projects: a self-hosted instance missing from the variable also lost its diffs,
    // change requests and webhooks. The forge declared on the `repos` row is the authorisation, picked
    // by the operator next to the URL they typed. Only crate import keeps the list (crate-apply.ts).
    if (!tokens.has(kind)) tokens.set(kind, tokenFor(projectId, kind));
    const token = tokens.get(kind) ?? null;
    if (!token) {
      errors.push({
        repo: row.name,
        error: `secret ${credentialFor(kind).secretName} missing from the project (needed for ${kind})`,
      });
      continue;
    }
    let adapter: ForgeAdapter;
    try {
      adapter = forgeFor(kind);
    } catch (e) {
      // A missing adapter is a wiring defect. It becomes a per-repository error rather than an
      // exception: a failing repository never hides the others, our own failures included.
      errors.push({ repo: row.name, error: String((e as Error).message) });
      continue;
    }
    resolved.push({ repo: { name: row.name, url: row.url, forge: kind }, adapter, token });
  }
  return { resolved, errors, truncated: rows.length - kept.length };
}

/** A resolved forge connection: forge, adapter, token. No repository.
 *
 *  The inverse direction of `resolveForgeRepos`, living here for the reason this file exists.
 *  `resolveForgeRepos` starts from declared repositories and goes up to the token; discovering
 *  repositories starts from the token and goes down. Same triple (forge → secret → adapter), and this
 *  module is the only server place allowed to know all three. Writing it in `projects/` or a route would
 *  create a second place decrypting a secret and picking an adapter, the dispersion the 26/08 rework
 *  undid. What differs is the source of forges (`repos` rows vs stored secrets), not resolution. */
export type ResolvedForgeConnection = {
  kind: ForgeKind;
  adapter: ForgeAdapter;
  token: string;
  /** The host this token belongs to, resolved (set on the connection, else the instance default, else
   *  the public host). Resolved here, not in the adapter, because it is database data. It goes up to
   *  the caller because the failure message must name it. */
  instanceHost: string;
};

/** The key under which each forge stores its instance on the connection, or `null` when it asks for
 *  none. Not copied: it comes from the provider declaring it (`connections/gitlab-device.ts`). */
const INSTANCE_FIELD: Record<ForgeKind, string | null> = {
  // The GitHub tile asks for nothing: `api.github.com` is a constant.
  github: null,
  gitlab: GITLAB_HOST_FIELD,
};

/** The forges this project holds a token for, each with its instance, in `FORGE_KINDS` order.
 *
 *  An empty list means no connection, a state to name in the UI (with its way out: connect a provider),
 *  never an error. An unwired adapter is skipped quietly: a composition defect visible everywhere else. */
export function resolveForgeConnections(projectId: string): ResolvedForgeConnection[] {
  const out: ResolvedForgeConnection[] = [];
  for (const kind of FORGE_KINDS) {
    const field = INSTANCE_FIELD[kind];
    const found = freshSecretWithField(projectId, credentialFor(kind).secretName, field);
    if (!found) continue;
    try {
      out.push({
        kind,
        adapter: forgeFor(kind),
        token: found.value,
        instanceHost: forgeInstanceHost(kind, found.field),
      });
    } catch {
      /* unregistered adapter: a wiring defect, not a connection */
    }
  }
  return out;
}

/** What a forge refused to say, named per forge: the counterpart of `ForgeAccessError`, which names per
 *  repository. There is no repository to name yet here. */
export type ForgeDiscoveryError = { forge: ForgeKind; error: string };

/** A reachable repository and the forge serving it: what the UI checks. */
export type DiscoveredRepo = ForgeRepoCandidate & { forge: ForgeKind };

/** Repositories reachable through the project's connections.
 *
 *  Each forge is queried separately and its refusal named: an expired GitLab token must not hide GitHub
 *  repositories. A forge returning `null` ("unknown") becomes an error line; an empty list produces none,
 *  since it may be an account without repositories or an organisation that has not approved the app,
 *  and the port cannot tell. */
export async function discoverRepos(
  projectId: string,
  /** One page's timeout, from which a whole forge's budget derives (`× FORGE_DISCOVERY_PAGES`).
   *
   *  Configurable for one reason, as in `mergedTitlesByRepo`: exercising the "forge never answers"
   *  path without stalling the test suite fifteen seconds. No production caller passes it.
   *
   *  A safety net, not the main cap. The real cap is per page, in the adapter (see `withForgeTimeout`):
   *  only it lets a slow third page return the first two. This one bounds what an adapter loop does not
   *  (an adapter forgetting its own cap, or looping). On a correct adapter it never fires, being the sum
   *  of the page caps. */
  timeoutMs: number = FORGE_CALL_TIMEOUT_MS,
): Promise<{
  connected: ForgeKind[];
  repos: DiscoveredRepo[];
  errors: ForgeDiscoveryError[];
  truncated: boolean;
}> {
  const connections = resolveForgeConnections(projectId);
  const repos: DiscoveredRepo[] = [];
  const errors: ForgeDiscoveryError[] = [];
  // Truncation is judged per forge, not on the total: two forges with a hundred and fifty repositories
  // each make three hundred without either being truncated, and the UI would cry wolf.
  let truncated = false;
  for (const { kind, adapter, token, instanceHost } of connections) {
    let found: ForgeRepoCandidate[] | null;
    try {
      found = await withForgeTimeout(
        "reading the repos",
        () => adapter.listRepos(token, instanceHost),
        timeoutMs * FORGE_DISCOVERY_PAGES,
      );
    } catch (e) {
      errors.push({
        forge: kind,
        error: `${instanceHost} — ${String((e as Error)?.message ?? e).slice(0, 200)}`,
      });
      continue;
    }
    if (found === null) {
      // The host is named. Without it a framagit token queried on gitlab.com produced "token without
      // the right scope, expired", blaming a valid token and costing a whole diagnosis on 16/09. With
      // the instance now coming from the connection it should not happen for that reason; when someone
      // types a wrong URL in the tile, they must read which one.
      errors.push({
        forge: kind,
        error: `${instanceHost} did not return the repo list (token without the right scope, expired, or instance unreachable — check the host declared on the connection)`,
      });
      continue;
    }
    if (found.length >= FORGE_DISCOVERY_CAP) truncated = true;
    for (const candidate of found) repos.push({ ...candidate, forge: kind });
  }
  return { connected: connections.map((c) => c.kind), repos, errors, truncated };
}

/** The diff of `branch` on each project repository. Failures are in the response, per repository. */
export async function compareBranchOnRepos(projectId: string, branch: string): Promise<RepoDiff[]> {
  // In demo mode there is no token or network: the adapter is still asked and returns its fake diff.
  // Without this path the pre-review screen showed "secret missing".
  if (fakeMode()) {
    const rows = repoRowsOf(projectId).slice(0, FORGE_REPO_CAP);
    const out: RepoDiff[] = [];
    for (const row of rows) {
      const kind = effectiveForge(row) ?? "github";
      out.push(
        await forgeFor(kind).compareBranch(
          "",
          { name: row.name, url: row.url, forge: kind },
          branch,
        ),
      );
    }
    return out;
  }
  const { resolved, errors, truncated } = resolveForgeRepos(projectId);
  const out: RepoDiff[] = [];
  for (const { repo, adapter, token } of resolved)
    out.push(await adapter.compareBranch(token, repo, branch));
  for (const e of errors) out.push({ repo: e.repo, branch, files: null, error: e.error });
  // Truncation becomes a line like the others. Missing before: the UI claimed "the branch was pushed to
  // no repository" for a repository merely outside the first ten.
  if (truncated > 0)
    out.push({
      repo: `+${truncated} repo(s) not queried`,
      branch,
      files: null,
      error: `cap of ${FORGE_REPO_CAP} repos reached — those were not compared`,
    });
  return out;
}

/** Open change requests of `legion/*` branches, across all project repositories. */
export async function listOpenChangeRequests(projectId: string): Promise<OpenChangeRequest[]> {
  if (fakeMode()) {
    const rows = repoRowsOf(projectId).slice(0, FORGE_REPO_CAP);
    const out: OpenChangeRequest[] = [];
    for (const row of rows) {
      const kind = effectiveForge(row) ?? "github";
      out.push(
        ...(await forgeFor(kind).listOpen("", { name: row.name, url: row.url, forge: kind })),
      );
    }
    return out;
  }
  const { resolved, errors } = resolveForgeRepos(projectId);
  // No repository resolved and some errors: nothing can succeed, so throw rather than return an empty
  // list reading as "no open requests". A partial resolution returns what it has, as before; throwing
  // would lose the first ten repositories because of the eleventh.
  if (resolved.length === 0 && errors.length > 0)
    throw new Error(errors.map((e) => `${e.repo}: ${e.error}`).join(" · "));
  const out: OpenChangeRequest[] = [];
  for (const { repo, adapter, token } of resolved)
    out.push(...(await adapter.listOpen(token, repo)));
  return out;
}

/** What can be said about the merge state of one open change request attached to its task. `number`
 *  is `null` when the URL does not end with a number (placeholder, unknown shape), and the result then
 *  falls back to `"unknown"`, never guessed. `prState` (v26+): the PR's real state at the forge,
 *  replacing the frozen "open" label that lived in review/text.ts. */
export type TaskPrMergeState = {
  repo: string;
  url: string;
  number: number | null;
  mergeState: MergeState;
  prState?: "open" | "merged" | "closed";
  /** The CI state (red CI batch). Absent means not probed: the change request is no longer open, or
   *  nothing could be resolved. The UI offers the fix-CI action only on `"failing"`; neither
   *  `"pending"`, `"unknown"` nor absence counts as green (see `CheckState`). */
  checkState?: CheckState;
};

/** The full state of one change request: merge, state at the forge, and CI.
 *
 *  CI is only probed on an open request. A merged or closed PR offers no action, and two API calls per
 *  dead PR on every tab opening served nobody. A forge refusal on checks does not bring down the rest:
 *  it falls back to `"unknown"` and the merge state stays shown. */
async function stateOfChangeRequest(
  adapter: ForgeAdapter,
  token: string,
  repo: ForgeRepo,
  number: number,
): Promise<{
  mergeState: MergeState;
  prState: "open" | "merged" | "closed";
  checkState?: CheckState;
}> {
  const state = await adapter.mergeStateWithPrState(token, repo, number);
  if (state.prState !== "open") return state;
  const report = await adapter
    .checks(token, repo, number)
    .catch(() => ({ state: CHECK_STATE.unknown, failing: [] }));
  return { ...state, checkState: report.state };
}

/** The merge state of each already open PR of one task (`task.prUrls`), read on demand: one call per
 *  PR, like `listOpen`, never a poller.
 *
 *  Targeted, not swept: unlike `listOpenChangeRequests` (all project repositories, for the Reviews
 *  screen), this only knows the few repositories where this task already has a PR (`pr-tab.tsx` calls it
 *  with the URLs the task carries). An unresolved repository (missing secret, undetermined forge) or a
 *  failed read falls back to `"unknown"`, never an exception that would hide the task's other PRs. */
export async function mergeStatesOf(
  projectId: string,
  prs: readonly { repo: string; url: string }[],
): Promise<TaskPrMergeState[]> {
  if (prs.length === 0) return [];
  const repoNames = [...new Set(prs.map((p) => p.repo))];

  if (fakeMode()) {
    const rows = repoRowsNamed(projectId, repoNames);
    const byName = new Map(rows.map((r) => [r.name, r]));
    const out: TaskPrMergeState[] = [];
    for (const p of prs) {
      const number = numberOfChangeRequestUrl(p.url);
      const row = byName.get(p.repo);
      const kind = (row ? effectiveForge(row) : null) ?? "github";
      if (number === null) {
        out.push({ repo: p.repo, url: p.url, number, mergeState: "unknown" });
        continue;
      }
      try {
        const result = await stateOfChangeRequest(
          forgeFor(kind),
          "",
          { name: p.repo, url: row?.url ?? p.url, forge: kind },
          number,
        );
        out.push({ repo: p.repo, url: p.url, number, ...result });
      } catch {
        out.push({ repo: p.repo, url: p.url, number, mergeState: "unknown" });
      }
    }
    return out;
  }

  const { resolved } = resolveForgeRepos(projectId, repoNames, Infinity);
  const byRepoName = new Map(resolved.map((r) => [r.repo.name, r]));
  const out: TaskPrMergeState[] = [];
  for (const p of prs) {
    const number = numberOfChangeRequestUrl(p.url);
    const hit = byRepoName.get(p.repo);
    if (number === null || !hit) {
      out.push({ repo: p.repo, url: p.url, number, mergeState: "unknown" });
      continue;
    }
    try {
      const result = await stateOfChangeRequest(hit.adapter, hit.token, hit.repo, number);
      out.push({ repo: p.repo, url: p.url, number, ...result });
    } catch {
      out.push({ repo: p.repo, url: p.url, number, mergeState: "unknown" });
    }
  }
  return out;
}

/**
 * The latest merged PR titles, per repository (slice nav/18).
 *
 * It never throws, its main property. Network down, token missing or without rights, repository
 * without history, slow forge: none of these may prevent launching a session or opening a PR; the
 * conventional-type title remains, computed offline. But the failure is returned, named per repository,
 * so the caller says it in the trace: silence is not the absence of a problem but of information, which
 * let the title defect live until a PR was refused.
 */
export async function mergedTitlesByRepo(
  projectId: string,
  repoNames: readonly string[],
  /** The timeout, configurable only to exercise the "forge never answers" path without stalling the
   *  test suite five seconds. No production caller passes it. */
  timeoutMs: number = FORGE_CALL_TIMEOUT_MS,
): Promise<{ byRepo: { repo: string; titles: string[] }[]; errors: string[] }> {
  const byRepo: { repo: string; titles: string[] }[] = [];
  const errors: string[] = [];
  try {
    const { resolved, errors: accessErrors } = resolveForgeRepos(projectId, repoNames, Infinity);
    errors.push(...accessErrors.map((e) => `${e.repo}: ${e.error}`));
    const reads = resolved.map(async ({ repo, adapter, token }) => {
      try {
        // The timeout is `withForgeTimeout`'s, which carries the pattern for the whole module, including
        // the `unref` lesson that bit here.
        const titles = await withForgeTimeout(
          "reading the titles",
          () => adapter.listMergedTitles(token, repo),
          timeoutMs,
        );
        // A repository without titles is not an error: a new repository merged nothing.
        if (titles.length) byRepo.push({ repo: repo.name, titles });
      } catch (e) {
        errors.push(`${repo.name}: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      }
    });
    await Promise.all(reads);
  } catch (e) {
    // Including local failures (unreadable database, adapter wiring): this function promises never to
    // throw, for its own defects too.
    errors.push(String((e as Error)?.message ?? e).slice(0, 200));
  }
  // `Promise.all` order is not reflected in the output (each read pushes when it returns): restore it by
  // name so a session prompt is reproducible across launches.
  byRepo.sort((a, b) => a.repo.localeCompare(b.repo));
  return { byRepo, errors };
}

/** Assigns the change request to the token owner. Never fatal: the request is open, which is what
 *  matters. An unreadable number, a forge not saying whose token it is, a refused assignment: continue. */
async function assignToTokenOwner(on: ResolvedRepo, url: string): Promise<void> {
  try {
    const number = numberOfChangeRequestUrl(url);
    if (number === null) return;
    const login = await getTokenOwnerLogin(on.adapter, on.token);
    if (login) await on.adapter.assignChangeRequest(on.token, on.repo, number, login);
  } catch {
    /* assignment failed: continue silently */
  }
}

/**
 * Opens the change request for the run's branch on each targeted repository. Idempotent: if one is
 * already open for the branch, its URL is returned. Assigning the token owner is attempted after
 * creation, never fatal.
 */
export async function createChangeRequests(opts: {
  projectId: string;
  repoNames: string[]; // project repositories to target (those the branch was pushed to)
  branch: string;
  title: string;
  body: string;
  mock?: boolean;
}): Promise<{ prs: ChangeRequest[]; errors: string[] }> {
  // No write cap (`Infinity`): there never was one, and adding one would silently stop opening change
  // requests on an eleven-repository project.
  const rows = repoRowsNamed(opts.projectId, opts.repoNames);

  // "No repository targeted" is decided on the database, before mock and any secret: the only actionable
  // error for the human ("was the branch pushed?"), deserved by a mock session too. The reverse returned
  // a 502 with no reason.
  if (rows.length === 0) return { prs: [], errors: ["no repo targeted (was the branch pushed?)"] };

  // Mock touches neither secrets nor network: one URL per real project repository, not per requested
  // name, or a nonexistent name made a fake PR that went into `task.prUrls`.
  if (opts.mock)
    return {
      prs: rows.map((r) => ({ repo: r.name, url: `https://github.com/mock/${r.name}/pull/0` })),
      errors: [],
    };

  const { resolved, errors: accessErrors } = resolveForgeRepos(
    opts.projectId,
    opts.repoNames,
    Infinity,
  );

  const prs: ChangeRequest[] = [];
  const errors = accessErrors.map((e) => `${e.repo}: ${e.error}`);

  for (const { repo, adapter, token } of resolved) {
    const res = await adapter.create(token, repo, {
      branch: opts.branch,
      title: opts.title,
      body: opts.body,
    });
    if (res.ok) {
      prs.push({ repo: repo.name, url: res.url, ...(res.existing ? { existing: true } : {}) });
      await assignToTokenOwner({ repo, adapter, token }, res.url);
    } else {
      // The forge's vocabulary enters here and nowhere else server-side: humans read "merge request"
      // when the failure comes from GitLab. The code keeps a neutral name.
      errors.push(`${repo.name} (${adapter.changeRequestLabel}): ${res.error}`);
    }
  }
  return { prs, errors };
}
