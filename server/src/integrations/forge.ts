// The forge port: what Legion asks of a repository host, and nothing more.
//
// Until 25/08 GitHub was not an implementation but an assumption sewn into three layers: `preflight.ts`
// refused any host but `github.com`, `session-runner.mjs` filtered the credential store on that name,
// and `integrations/github.ts` required `https://github.com/<owner>/<repo>`. A GitLab project could not
// merely fail to open an MR: its agent did not start.
//
// What varies and what does not, the one design decision here. `clone`, `fetch`, `push`, `commit` do
// not vary: that is git. A per-forge strategy for them would be a one-implementation abstraction
// differing by a string, and would bring forge knowledge into the runner, which must stay ignorant.
//
// What varies is three things, two of which deserve code:
//   1. The credential to present to git: a table (conventional username + secret name), not a
//      strategy. That is all push needs.
//   2. The review API: create a change request, list them, read comments. Different APIs, shapes and
//      vocabulary. This is where the port serves.
//   3. URL shapes. Hence no `owner`/`repo` pair in this port: GitLab allows nested groups
//      (`group/subgroup/project`), which GitHub's two segments cannot represent. The port only knows
//      an opaque project path, which each adapter encodes as its API requires.
//
// Pure: no database, secret or network call. Resolution (which repository, which token) lives in
// `forge-access.ts`; API calls in `github.ts` and `gitlab.ts`, which get their token as an argument.

export const FORGE_KINDS = ["github", "gitlab"] as const;
export type ForgeKind = (typeof FORGE_KINDS)[number];

export function isForgeKind(value: unknown): value is ForgeKind {
  return typeof value === "string" && (FORGE_KINDS as readonly string[]).includes(value);
}

/** What a forge requires for `git push` to pass, nothing else.
 *
 *  `username` is not a secret but a public, documented forge convention (GitHub accepts anything with a
 *  PAT and recommends `x-access-token`; GitLab requires `oauth2` for a group or project token).
 *  `secretName` is the name of a project secret, never its value, which leaves the database only
 *  encrypted and enters the container only through the existing secrets channel. */
export type ForgeCredential = {
  readonly username: string;
  readonly secretName: string;
};

const CREDENTIALS: Record<ForgeKind, ForgeCredential> = {
  github: { username: "x-access-token", secretName: "GITHUB_TOKEN" },
  gitlab: { username: "oauth2", secretName: "GITLAB_TOKEN" },
};

export function credentialFor(kind: ForgeKind): ForgeCredential {
  return CREDENTIALS[kind];
}

/** The repository as the port sees it: a short name, an https URL, a declared forge. */
export type ForgeRepo = {
  name: string;
  url: string;
  forge: ForgeKind;
};

// ---- What the port returns ----

export type DiffFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** `null` means the diff content is unavailable (binary, file too large, diff collapsed by the
   *  forge). The UI must say so, not guess. */
  patch: string | null;
};

export type RepoDiff = {
  repo: string;
  branch: string;
  /** `null` means the branch does not exist on this repository (nothing pushed here), not an error. */
  files: DiffFile[] | null;
  error: string | null;
};

/** A change request: "pull request" at GitHub, "merge request" at GitLab. The neutral name is the
 *  domain's; the forge's vocabulary is for talking to humans (`changeRequestLabel`), not structuring
 *  code. */
export type ChangeRequest = { repo: string; url: string; existing?: boolean };

export type ForgeComment = {
  id: string;
  author: string;
  body: string;
  /** The commented file when the comment is on code; `null` in discussion. */
  path: string | null;
  url: string;
  createdAt: string;
};

/** A change request's merge state against its default branch.
 *
 *  `"unknown"` covers two causes never told apart in the UI: the forge has not finished computing
 *  (GitHub returns `mergeable: null` while it works in the background, see `github.ts`), or the call
 *  failed (token without rights, silent forge). Neither is "no conflict": mapping `null` or a failure
 *  to `"mergeable"` would lie about what is known. */
export const MERGE_STATE = {
  mergeable: "mergeable",
  conflict: "conflict",
  unknown: "unknown",
} as const;
export const MERGE_STATES = [
  MERGE_STATE.mergeable,
  MERGE_STATE.conflict,
  MERGE_STATE.unknown,
] as const;
export type MergeState = (typeof MERGE_STATES)[number];

/** A change request's CI state: the same trap as `MergeState`, on another field.
 *
 *  `"unknown"` is not "passing". It covers what is not known: the token may not read runs (GitHub 403
 *  without `actions:read`), the forge did not answer, or no check is attached to the branch head (a
 *  repository using only legacy commit statuses has no check run). `"pending"` is the other half:
 *  checks still running, no verdict yet.
 *
 *  Mapping either to `"passing"` would hide the fix-CI action exactly when it is useful; mapping to
 *  `"failing"` would start a session on uncertainty. The four states stay distinct up to the UI, which
 *  offers the action only on `"failing"`.
 *
 *  A failure wins over pending: if one job is red while three run, CI is red; there is something to
 *  act on, and waiting would not change that verdict. */
export const CHECK_STATE = {
  passing: "passing",
  failing: "failing",
  pending: "pending",
  unknown: "unknown",
} as const;
export const CHECK_STATES = [
  CHECK_STATE.passing,
  CHECK_STATE.failing,
  CHECK_STATE.pending,
  CHECK_STATE.unknown,
] as const;
export type CheckState = (typeof CHECK_STATES)[number];

/** A red check with what is needed to act, not just observe: its name (what humans read in CI), its URL
 *  (where to look), and its id at the forge, which `checkLog` needs to return the job output. */
export type FailingCheck = {
  /** The job id as the forge wants it for logs (GitHub Actions: the job id read from `details_url`;
   *  GitLab: the pipeline job id). */
  id: string;
  name: string;
  url: string;
};

/** A change request's CI state and the red jobs justifying it. `failing` is only filled when
 *  `state === "failing"`. */
export type ChecksReport = {
  state: CheckState;
  failing: FailingCheck[];
};

/** A change request's state at the forge. External vocabulary fixed by GitHub and GitLab: the constant
 *  keeps a hand-written `"open"` from drifting from what the API returns. It is spelled like a
 *  pre-review comment status and means something else, which an automated replace once confused.
 *
 *  No column behind it: never stored, read on demand, since a PR merged from the forge's UI would not
 *  notify us. */
export const PR_STATE = {
  open: "open",
  merged: "merged",
  closed: "closed",
} as const;
export const PR_STATES = [PR_STATE.open, PR_STATE.merged, PR_STATE.closed] as const;
export type PrState = (typeof PR_STATES)[number];

export type OpenChangeRequest = {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  comments: ForgeComment[];
  mergeState: MergeState;
};

/** A creation result: success (with `existing` if it was already open) or the reason. */
export type CreateResult =
  | { ok: true; url: string; existing: boolean }
  | { ok: false; error: string };

/** A webhook hook-up result (webhooks batch, 03/09): the forge-side hook id, stored on the repository,
 *  or the refusal reason in full. `existing` means a hook already pointing at this URL was found rather
 *  than created (idempotent, like `create`). */
export type RepoHookResult =
  | { ok: true; id: string; existing: boolean }
  | { ok: false; error: string };

// ---- The port ----

/** A repository a connection's token can reach: just what is needed to pick it in the UI and add it to
 *  the project. No description, date or star count: those are displayed, the add does not depend on
 *  them.
 *
 *  `fullName` is the project path as the forge states it (`org/repo`, GitLab nested groups included),
 *  the same opaque notion as `projectPath` seen from the other end. */
export type ForgeRepoCandidate = {
  fullName: string;
  /** The https clone URL. This is what gets stored on the project: a fact returned by the forge, never
   *  recomposed from a host and a path. */
  url: string;
  private: boolean;
};

/** The discovery cap, named and deliberate: three pages of a hundred, so 300 repositories.
 *
 *  A three-hundred-repository account must not make three hundred requests when a screen loads. An
 *  account with more does not have a wrong list but a truncated one, which the route reports and the UI
 *  says, with the way out (typing the URL). A silent truncation would be worse than a low cap: it would
 *  read as "this repository does not exist". */
export const FORGE_DISCOVERY_PAGES = 3;
export const FORGE_DISCOVERY_PER_PAGE = 100;
export const FORGE_DISCOVERY_CAP = FORGE_DISCOVERY_PAGES * FORGE_DISCOVERY_PER_PAGE;

/** The variable giving the GitLab instance default when a connection declares none. The same one the
 *  connection flow reads (`connections/gitlab-device.ts`). */
export const GITLAB_HOST_VAR = "LEGION_GITLAB_HOST";

/** A connection's instance host: whom this token belongs to.
 *
 *  An instance host is not a GitLab notion, which is why the function sits in the port next to
 *  `hostOfRepoUrl`: GitHub Enterprise asks the same question. What is forge-specific is the default
 *  answer, in the two branches below.
 *
 *  Order matters, as in the connection flow: what is set on the connection wins, then the instance
 *  default, then the public host. An operator with a framagit token and a gitlab.com token has two valid
 *  tokens that cannot be presented to the same host; a global variable necessarily refused one.
 *
 *  GitHub declares nothing, and we do not pretend: its tile asks for no field and `gh()` talks to
 *  `api.github.com`, a constant. Honouring a host here would name an instance nobody queries; an
 *  Enterprise needs more than a host. */
export function forgeInstanceHost(kind: ForgeKind, declared: string | null): string {
  if (kind === "github") return "github.com";
  const raw = declared?.trim() || process.env[GITLAB_HOST_VAR] || "gitlab.com";
  // Scheme and trailing `/` go: the tile accepts `https://git.example.com/`, the API wants a host.
  // Without it we would compose `https://https://git.example.com//api/v4`.
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/** A forge call's timeout. Five seconds: generous for an API call, short for an outage. These reads are
 *  on paths a human waits for (session launch, adding a repository, opening the Repositories screen). */
export const FORGE_CALL_TIMEOUT_MS = 5_000;

/** The timeout, set once for everyone.
 *
 *  `undici` allows 300 s of `headersTimeout` by default, so a silent instance held a `POST /api/repos`
 *  open five minutes, spinner included, with the repository row already written. The pattern lived in
 *  `mergedTitlesByRepo`; it was extracted rather than copied.
 *
 *  In the port, not `forge-access.ts` (round 2), because adapters need it: a timeout around `listRepos`
 *  wraps its three pages and throws away the partial result an adapter's loop promises ("a page failing
 *  after the first truncates, it does not erase"). The timeout goes per page, where the call is made.
 *
 *  `Promise.race` rather than an `AbortSignal` threaded everywhere: the abandoned request continues in
 *  the background and its response is discarded. Accepted cost: one signature fewer for a socket
 *  lingering a few seconds.
 *
 *  The timer is cleared in `finally`, never `unref`. `unref` looked cleaner and removed the only thing
 *  keeping the event loop awake while waiting: the process exited before the timeout fired, and the
 *  call never returned. */
export async function withForgeTimeout<T>(
  /** What was being read, verbatim, because this text reaches humans (in a session trace or under a
   *  repository list). "the forge did not answer" says nothing; "reading the titles > 5000 ms" does. */
  what: string,
  run: () => Promise<T>,
  timeoutMs: number = FORGE_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} > ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** An address of the token owner's account, as the forge declares it. */
export type VerifiedEmail = { email: string; primary: boolean };

/** An adapter is humble: it translates a remote API and decides nothing. It does not read the database,
 *  decrypt secrets, or know what a task is. Its token is given to it. */
export interface ForgeAdapter {
  readonly kind: ForgeKind;
  /** The word humans expect on screen and in error messages. */
  readonly changeRequestLabel: string;
  /** The project path as this forge's API wants it, or `null` if the URL is not this forge's. Opaque:
   *  nobody else interprets it. */
  projectPath(url: string): string | null;
  /** Compares the repository's default branch with `branch`. Failures are named in the response: an
   *  unreachable repository must never hide the others' diff. */
  compareBranch(token: string, repo: ForgeRepo, branch: string): Promise<RepoDiff>;
  /** Open change requests of this repository whose source branch is `legion/*`, with their comments.
   *  One repository at a time: the loop and its cap belong to the caller, which alone can say what it
   *  truncated. */
  listOpen(token: string, repo: ForgeRepo): Promise<OpenChangeRequest[]>;
  /** The merge state of one open change request, read on demand, never cached here (the caller decides
   *  whether to retry). See `MergeState` for what `"unknown"` covers. */
  mergeState(token: string, repo: ForgeRepo, number: number): Promise<MergeState>;
  /** The CI state of one open change request, with the red jobs justifying it (red CI batch). Read on
   *  demand like `mergeState`. See `CheckState`: neither `"unknown"` nor `"pending"` means passing.
   *
   *  Does not throw on a forge refusal: a 403 without `actions:read` is "unknown", not an outage. Network
   *  failures do surface; the caller returns them as 502 rather than passing them off as a verdict. */
  checks(token: string, repo: ForgeRepo, number: number): Promise<ChecksReport>;
  /** The raw output of a red job, designated by the `id` `checks` returned, never a summary: the only
   *  data saying what broke. `null` means the forge did not give it (GitHub token without
   *  `actions:read`, expired log, job without trace). The caller must then continue with the job name
   *  and URL: a missing log is not a cancelled action. Bounding belongs to the caller. */
  checkLog(token: string, repo: ForgeRepo, checkId: string): Promise<string | null>;
  /** The full state of one change request: merge state plus real state at the forge (v26+). `prState`
   *  ("open" | "merged" | "closed") replaces the frozen label review/text.ts:pr.open. */
  mergeStateWithPrState(
    token: string,
    repo: ForgeRepo,
    number: number,
  ): Promise<{ mergeState: MergeState; prState: PrState }>;
  /** Creates the change request, or finds the one already open for this branch (idempotent). */
  create(
    token: string,
    repo: ForgeRepo,
    opts: { branch: string; title: string; body: string },
  ): Promise<CreateResult>;
  /** Titles of this repository's most recent merged change requests, newest first (slice nav/18). The
   *  only way to know how this repository writes titles: no hard-coded convention fits two repositories
   *  of one project.
   *
   *  One page, never paginated: a style is sought, not an inventory. Throws on refusal like `listOpen`:
   *  a token without rights must say so rather than return an empty list reading as "no convention".
   *  The caller (`mergedTitlesByRepo`) catches. */
  listMergedTitles(token: string, repo: ForgeRepo): Promise<string[]>;
  /** The login of the user owning the token (the project operator). The implementation may cache: one
   *  call per token per process is enough. */
  getTokenOwnerLogin(token: string): Promise<string | null>;
  /** Verified addresses of the token owner's account: the only source saying whether a commit signed with
   *  an address will be attached to this account.
   *
   *  `null` is not an empty list: it means the forge did not say (token not allowed to read addresses,
   *  forge not exposing them), and the caller must conclude "unknown", never "unlinked". */
  listVerifiedEmails(token: string): Promise<VerifiedEmail[] | null>;
  /** Repositories this token can reach, at most `FORGE_DISCOVERY_CAP`.
   *
   *  `null` when the forge refuses to answer: "unknown" is not an empty list, as for
   *  `listVerifiedEmails`. Token without the scope, silent instance, network failure: the caller must be
   *  able to say so rather than show "you have no repositories", the reassuring false answer.
   *
   *  An empty list is not "no repositories" either: a GitHub organisation restricting third-party app
   *  access disappears from `/user/repos` without error until an admin approves. The UI names that
   *  friction; the port can only return what the forge says.
   *
   *  `instanceHost` is the host to talk to, resolved by `forgeInstanceHost`: the only port read starting
   *  from a token rather than a repository, so the only one where no URL says which instance it belongs
   *  to. Without it a framagit token was queried on gitlab.com, got a 401, and the UI blamed a valid
   *  token. */
  listRepos(token: string, instanceHost: string): Promise<ForgeRepoCandidate[] | null>;
  /** Assigns the change request to the given user. A failure is logged but never fails PR creation:
   *  a boolean rather than an exception. */
  assignChangeRequest(
    token: string,
    repo: ForgeRepo,
    number: number,
    login: string,
  ): Promise<boolean>;
  /** Hooks Legion's inbound webhook on this repository: the forge will call `opts.url` on each change
   *  request event, signed with `opts.secret` (HMAC at GitHub, header token at GitLab). Idempotent: a
   *  hook already on this URL is found, never duplicated. */
  createRepoHook(
    token: string,
    repo: ForgeRepo,
    opts: { url: string; secret: string },
  ): Promise<RepoHookResult>;
}

const ADAPTERS = new Map<ForgeKind, ForgeAdapter>();

/** Registers an adapter, called by each adapter module at load; the only reason this registry is
 *  mutable: `forge.ts` must import no adapter, or the dependency would point outward. */
export function registerForge(adapter: ForgeAdapter): void {
  ADAPTERS.set(adapter.kind, adapter);
}

export function forgeFor(kind: ForgeKind): ForgeAdapter {
  const found = ADAPTERS.get(kind);
  // A missing adapter is a wiring error, not doubtful data: say it loudly rather than return `undefined`
  // and fail three calls later.
  if (!found)
    throw new Error(`forge “${kind}” not registered (missing import on the composition side)`);
  return found;
}

/** Git has two URL grammars, and `new URL()` knows one.
 *
 *  `https://github.com/o/r.git` parses. `git@github.com:o/r.git` does not: it is the scp form, older
 *  than URIs, which `new URL()` reads as scheme `git@github.com` plus an opaque path. Any
 *  `new URL(repo.url).host` in a `try` returns the host of https repositories and nothing for SSH ones,
 *  silently, because the `catch` is a `continue`.
 *
 *  Harmless while non-https URLs were refused at preflight. Once an SSH key made `git@…` legitimate
 *  (v40), an SSH repository escaped every host-based check, the network allowlist first. Hence this
 *  function, the module's only source of hosts. */
export function hostOfRepoUrl(url: string): string | null {
  const raw = url.trim();
  // scp form: `[user@]host:path`. The `:` must not be followed by `//` (that would be a scheme), and the
  // host must not contain `/` (that would already be a path).
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)/.exec(raw);
  if (scp) return scp[1]!.toLowerCase();
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The variable declaring self-hosted forges: comma-separated hosts, in addition to the two public
 *  forges, always allowed. */
export const FORGE_HOSTS_VAR = "LEGION_FORGE_HOSTS";

const PUBLIC_FORGE_HOSTS: readonly string[] = ["github.com", "gitlab.com"];

/** Hosts a forge token may be presented to (05/09, audit wave 1).
 *
 *  The GitLab API host was read from the repository URL (`gitlab.ts`, `apiBase`) with no bound: a
 *  mistyped URL, or one set by a third party, sent the project's `PRIVATE-TOKEN` there on every call. The
 *  control plane calls forges without the egress proxy (only containers are behind the wall).
 *
 *  Since 08/09 it only guards crate import (`projects/repo-url.ts`): at the other doors the operator
 *  types the URL and picks the forge, and that act is the authorisation.
 *
 *  Read on each call, not frozen at import, so it is testable without reloading. Additive: declaring an
 *  instance never removes the public forges. Exact comparison on what `hostOfRepoUrl` returns, port
 *  included (`gitlab.local:8443` is declared as is): an `endsWith` would admit what was not written. */
export function allowedForgeHosts(): ReadonlySet<string> {
  const declared = (process.env[FORGE_HOSTS_VAR] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return new Set([...PUBLIC_FORGE_HOSTS, ...declared]);
}

/** The reason to refuse a repository URL's host, or `null` if allowed. The message names the host and
 *  the variable that would admit it, the one thing the human has to do. An unreadable host is refused
 *  too: no token is presented to what cannot be named. */
export function forgeHostRefusal(url: string): string | null {
  const host = hostOfRepoUrl(url);
  if (host === null) return `unreadable host in URL ${url}`;
  const allowed = allowedForgeHosts();
  if (allowed.has(host)) return null;
  return `host “${host}” is outside the allowed forges (${[...allowed].join(", ")}) — add it to ${FORGE_HOSTS_VAR} to admit it`;
}

/** A repository reachable only with a key: scp form (`git@host:path`) or `ssh://`. The question
 *  preflight asks, with only these two answers. */
export function isSshRepoUrl(url: string): boolean {
  const raw = url.trim();
  return /^ssh:\/\//i.test(raw) || /^(?:[^@/]+@)?[^/:]+:(?!\/)/.test(raw);
}

/** The forge guessed from the host, to pre-fill repository creation. Never authoritative: a self-hosted
 *  GitLab is not called `gitlab.com`, so the forge is declared on the repository and this only suggests
 *  a default. */
export function forgeOfUrl(url: string): ForgeKind | null {
  const host = hostOfRepoUrl(url);
  if (!host) return null;
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  return null;
}

/** A repository's effective forge: one rule shared by preflight, the spec and resolution. It decides
 *  whom a token is presented to, so it is not guessed twice.
 *
 *  `null` means unknown, and that is a refusal, not a default. Reading a forge-less row as GitHub was
 *  right while GitHub was the only possible forge (no Bitbucket or internal repository could exist
 *  before v34). Keeping that default would present the GitHub PAT to `bitbucket.org`, which the runner's
 *  former `host === "github.com"` filter forbade. The constant goes, the guarantee stays: a repository
 *  without a declared forge is GitHub only if its host really is. */
export function effectiveForge(repo: { url: string; forge?: string | null }): ForgeKind | null {
  if (isForgeKind(repo.forge)) return repo.forge;
  return forgeOfUrl(repo.url);
}

/** The raw project path of a URL: everything after the host, without `.git` or stray slashes. Shared by
 *  both adapters because it is URL grammar, not a forge specific: GitHub uses it for its two segments,
 *  GitLab for nested groups. */
export function pathOfRepoUrl(url: string): string | null {
  const raw = url.trim();
  // scp form: `git@github.com:AcmeHQ/backend.git`. It returned `null` until v40, which was fine while an
  // SSH repository could not exist: a `null` here does not block a clone, it prevents opening the change
  // request. With `git@…` legitimate, the agent would push its branch and leave without a PR, the
  // quietest failure of the batch.
  //
  // A repository's path does not depend on how it is reached: `AcmeHQ/backend` is the same over https
  // and SSH.
  const scp = /^(?:[^@/]+@)?[^/:]+:(?!\/)(.+)$/.exec(raw);
  const rawPath = scp
    ? scp[1]!
    : (() => {
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          return null;
        }
        // `ssh://` joins https: both carry a readable path. `http://` stays refused: a forge we do not
        // want to call in clear.
        if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") return null;
        return parsed.pathname;
      })();
  if (rawPath === null) return null;
  const path = rawPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  return path.length > 0 ? path : null;
}

/** A change request's number, read from its URL: the last numeric segment, common to both forges
 *  (`.../pull/62`, `.../-/merge_requests/62`). The only data a `PrUrl` (`{repo, url}`) already carries:
 *  reading it back beats adding a column and a migration. `null` means the URL does not end with a
 *  number (demo placeholder, unknown shape), never guessed. */
export function numberOfChangeRequestUrl(url: string): number | null {
  const m = /\/(\d+)\/?(?:[?#].*)?$/.exec(url.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Lines added and removed in a unified diff.
 *
 *  GitHub returns `additions`/`deletions` per file; GitLab does not (its `/repository/compare` returns
 *  only the diff text, per the v4 API docs). Rather than one adapter showing 0 and the other the real
 *  count, it is computed. `+++`/`---` headers are excluded: counting them would shift every total by
 *  exactly two per file. */
export function countDiffLines(patch: string | null): { additions: number; deletions: number } {
  if (!patch) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  // `--- a/x` / `+++ b/x` headers are skipped only before the first `@@`, the only correct way.
  // Skipping them everywhere created a silent false negative: a removed content line `---` is written
  // `----` in a diff, a removed YAML front-matter `--- title` line is `---- title`, and both start with
  // `---`. The file then showed fewer deletions than it had. In practice both APIs start patches at `@@`
  // (neither emits the header), so this guard only matters if one changes; all the more reason for it
  // to be right.
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("+++") || line.startsWith("---"))) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}
