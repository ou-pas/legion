import { json, patch, post } from "./client.js";

/** Whether the project's git identity is attributed. THREE states, and the third counts as much as
 *  the others: `unknown` = the forge did not answer, which is not "no". */
export type GitIdentityCheck = {
  status: "attributed" | "unlinked" | "unknown";
  email: string;
  login: string | null;
  /** An address known to be attributed, when the forge named one. */
  suggestion: string | null;
  /** The sentence to show verbatim. `null` when all is well. */
  reason: string | null;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  defaultModel: string;
  repoUrl: string | null;
  fsRoot: string | null;
  context: string;
  demo: boolean;
  /** Git identity of agent commits (v19), per project. `null` = default ("Legion" /
   *  "legion@local"), see server/src/projects/git-identity.ts. */
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  /** v35: serialised JSON string[] of skills active on the whole project. Stored HERE, not in a
   *  table, because a skill is a folder on disk: what is kept is a choice about a skill. */
  defaultSkillNames: string;
  /** Complexity → model routing (v24): serialised JSON `{low?, med?, high?}`, never null (column
   *  default `{"low":"haiku","high":"opus"}`). A missing key falls back to `defaultModel`. See
   *  server/src/models/model.ts. */
  modelRouting: string;
  /** Chain role → agentId mapping (v29): serialised JSON `{ role: agentId }`, never null (default
   *  `{}`). A missing key falls back to the catalog agent by name. Resolved when a chain is
   *  instantiated, never re-resolved mid-run. */
  chainBindings: string;
  /** v40: how this project's sessions run. `null` on both = the control plane's default image, no
   *  key mounted. `sshKeyPath` is a PATH ON THE DOCKER HOST, not a key: the key's value never
   *  enters the database, so never here. */
  sessionImage: string | null;
  /** v67: the PASTED Dockerfile next to the tag it builds; `null` = just the declared image (or
   *  the base). Never a repository file: an operator setting, like `sessionImage`. */
  sessionDockerfile: string | null;
  sshKeyPath: string | null;
  /** v47: the CHOSEN hue of the project mark, a rank 0 to 11 on the `ui/tokens.css` scale. `null`
   *  = nobody chose, the name/id derivation holds (`projects/project-mark.ts`). That is the default. */
  hue: number | null;
};
/** The image this project ACTUALLY uses, on ONE runner (09/09, Kopee.me outage), see
 *  `server/src/infra/project-image.ts`. */
export type ProjectImageState = {
  tag: string;
  dockerfile: { present: boolean; valid: boolean; error: string | null };
  present: boolean;
  builtHash: string | null;
  currentHash: string | null;
  stale: boolean;
  rebuilding: boolean;
};
export type ProjectImageRunner = { runnerId: string; runnerName: string; image: ProjectImageState };

/** Only the id that travels on the wire; label and expected secret live in
 *  `web/src/projects/forge.ts`. */
export type ForgeKind = "github" | "gitlab";
/** `forge: null` = a row older than migration v34, read as GitHub by the server. */
export type Repo = {
  id: string;
  projectId: string;
  name: string;
  url: string;
  forge: ForgeKind | null;
  /** v54. The inbound webhook on this repo: the forge-side hook id (`null` = never connected) and
   *  the URL it calls. The URL lets the screen say "reconnect" when the instance's public URL has
   *  changed since; a "connected" without reference could not be checked. */
  webhookId: string | null;
  webhookUrl: string | null;
  testCommand: string | null;
  createdAt: string;
};
/** A repository the project's connections reach, ticked instead of typing a URL. `declared` = the
 *  project already has it: shown, not offered a second time. */
export type AvailableRepo = {
  fullName: string;
  url: string;
  private: boolean;
  forge: ForgeKind;
  declared: boolean;
};

/** Discovery result and its three silences.
 *
 *  `connected: []` = no provider connected: an empty state with a way out, not a failure.
 *  `truncated` = the server cap bit; the screen must SAY the list is incomplete rather than imply a
 *  missing repository does not exist.
 *  `errors` = a forge did not answer; the others stay displayed. */
export type AvailableRepos = {
  connected: ForgeKind[];
  repos: AvailableRepo[];
  truncated: boolean;
  errors: { forge: ForgeKind; error: string }[];
};

/** The git identity SET by adding a repository, `null` if there was nothing to do. It comes back
 *  with the created repo: a value appearing by itself on another screen unannounced is a surprise,
 *  not a service. */
export type CreatedRepo = Repo & { gitIdentityAdopted: { name: string; email: string } | null };

export type ProjectFootprint = {
  tasks: number;
  sessions: number;
  agents: number;
  goals: number;
  repos: number;
  rules: number;
  mcpServers: number;
  secrets: number;
  environments: number;
  templates: number;
  inbox: number;
};
export type LiveSession = { id: string; status: string; taskName: string };
/** The four rename fields are present ONLY if `name` was in the request. A refused slug is not an
 *  error: the name did change. */
export type PatchProjectResult = {
  ok: true;
  name?: string;
  slug?: string;
  slugMoved?: boolean;
  slugReason?: string | null;
};
/** `label` is the key's readable name, a COLUMN next to the ciphertext, never inside (v48): it
 *  reads without the master key, and still reads when the value no longer decrypts. `null` = never
 *  named, which is not an erased label; the screen then shows `name`. */
export type Secret = { id: string; name: string; label: string | null; projectId: string };

/** `name` is the VARIABLE NAME that won, never its value, which does not leave the server. */
export type ActiveCredential = {
  credentialId: string | null;
  from: "project" | "control-plane" | "none";
  name: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY" | null;
  label: string | null;
  /** `false` = every project account is exhausted; sessions sleep until `retryAt`. The most frequent
   *  case on screen, and the only one that must jump out. */
  available: boolean;
  retryAt: string | null;
};
/** The three windows of a Claude subscription. `seven_day_opus` is counted apart from `seven_day`:
 *  they close and reopen independently. */
export type CredentialWindow = "five_hour" | "seven_day" | "seven_day_opus";
/** An account in a project's ORDERED list (v64/v25). The value never leaves: rank, variable name,
 *  label, and what is still closed. */
export type RankedCredential = {
  id: string;
  name: "CLAUDE_CODE_OAUTH_TOKEN";
  rank: number;
  label: string | null;
  /** Windows STILL closed, latest first; empty = this account is usable. */
  exhausted: { window: CredentialWindow; until: string }[];
};
export type ProjectCredentials = {
  credentials: RankedCredential[];
  /** The account serving NOW, per server resolution, never recomputed here. */
  active: ActiveCredential;
};
/** Secret names that act as the PROJECT's Claude credential instead of the control plane's. Mirror
 *  of `CREDENTIAL_NAMES` (server/src/projects/credential-resolution.ts): injected into every project
 *  session WITHOUT going through the agent's grants, since they are what lets the session exist.
 *  Here and not in a screen: two screens need them, and a copy would drift. */
export const AUTH_SECRET_NAMES = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];

export const projectsApi = {
  /** Will the forge ATTRIBUTE the configured address to an account? A network call, so apart from
   *  screen loading: the card calls it itself and can live without an answer. See
   *  server/src/projects/git-identity-check.ts. */
  gitIdentityCheck: (id: string): Promise<GitIdentityCheck> =>
    fetch(`/api/projects/${id}/git-identity-check`).then(json),
  /** What deleting the project would destroy, plus the sessions preventing it. */
  projectFootprint: (id: string): Promise<{ footprint: ProjectFootprint; live: LiveSession[] }> =>
    fetch(`/api/projects/${id}/footprint`).then(json),
  deleteProject: (
    id: string,
  ): Promise<{ ok: true; deleted: string; footprint: ProjectFootprint }> =>
    fetch(`/api/projects/${id}`, { method: "DELETE" }).then(json),
  createProject: (body: { name: string; fsRoot?: string; repoUrl?: string }): Promise<Project> =>
    post("/api/projects", body),
  /** The side door of the no-project screen: look before connecting your repository. Idempotent: it
   *  OPENS the demo, it does not stack another (server/src/projects/demo.ts). */
  openDemoProject: (): Promise<{ id: string; created: boolean }> => post("/api/projects/demo", {}),
  patchProject: (
    id: string,
    body: {
      context?: string;
      gitAuthorName?: string;
      gitAuthorEmail?: string;
      /** Always send the THREE keys (null = that level falls back to the project default): the
       *  server replaces the whole object, an omitted key resets (v24 contract). */
      modelRouting?: { low?: string | null; med?: string | null; high?: string | null } | null;
      /** Same contract as modelRouting (v29): send ALL bindings to keep; an omitted key = catalog
       *  fallback; null = clear all. */
      chainBindings?: Record<string, string> | null;
      /** v35: skills active on every project agent. The list REPLACES the previous one; a name
       *  matching no uploaded skill is refused by name. */
      defaultSkillNames?: string[];
      /** v40. Empty string = back to the default image. */
      sessionImage?: string;
      /** v67: the pasted Dockerfile, a thin layer over `sessionImage`. Empty string = nothing more. */
      sessionDockerfile?: string;
      /** v40: private SSH key path ON THE DOCKER HOST. Empty string = no key. */
      sshKeyPath?: string;
      /** v42. The server recomputes the `slug`, which FOLLOWS only if it can: the response says
       *  which happened, and why. */
      name?: string;
      /** v47. `null` REMOVES the choice and hands back to the derivation; an absent key touches
       *  nothing. Unlike the neighbouring text fields, where an empty string means "default". */
      hue?: number | null;
      /** Slice nav/2a: the model routing's last fallback, named in the three complexity selectors
       *  with no field to set it. No `null`: unlike `hue`, there is no derivation to return to. */
      defaultModel?: string;
    },
  ): Promise<PatchProjectResult> =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json),
  patchRepo: (id: string, body: { testCommand?: string | null; forge?: ForgeKind }) =>
    fetch(`/api/repos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json),
  repos: (projectId: string): Promise<Repo[]> =>
    fetch(`/api/repos?projectId=${projectId}`).then(json),
  /** Repositories reachable by the project's connections: a FACT fetched, where the URL was a fact
   *  the operator had to type. */
  availableRepos: (projectId: string): Promise<AvailableRepos> =>
    fetch(`/api/repos/available?projectId=${projectId}`).then(json),
  createRepo: (body: {
    projectId: string;
    name: string;
    url: string;
    forge?: ForgeKind;
  }): Promise<CreatedRepo> => post("/api/repos", body),
  deleteRepo: (id: string) => fetch(`/api/repos/${id}`, { method: "DELETE" }).then(json),
  secrets: (): Promise<Secret[]> => fetch("/api/secrets").then(json),
  /** The project's ordered Claude credentials and the VERDICT: which account actually serves
   *  (`active`), including the control plane's, which is in no list. */
  credentials: (projectId: string): Promise<ProjectCredentials> =>
    fetch(`/api/projects/${projectId}/credentials`).then(json),
  /** A subscription token ALWAYS arrives at the last rank. */
  addCredential: (
    projectId: string,
    body: { value: string; label?: string },
  ): Promise<{ ok: true; id: string; rank: number }> =>
    post(`/api/projects/${projectId}/credentials`, body),
  /** Label and rank, never the value: renewing a token means adding another (`addCredential`). */
  patchCredential: (id: string, body: { label?: string; rank?: number }) =>
    patch(`/api/credentials/${id}`, body),
  deleteCredential: (id: string) =>
    fetch(`/api/credentials/${id}`, { method: "DELETE" }).then(json),
  /** Saving the same name replaces the value (key renewal), no duplicate. */
  saveSecret: (body: {
    projectId: string;
    name: string;
    value: string;
    label?: string;
  }): Promise<{ ok: true; replaced: boolean }> => post("/api/secrets", body),
  /** Renames a key WITHOUT reposting its value: fixing a typo in a label must not force pasting a
   *  token again. `""` clears the label rather than storing an empty one. */
  setSecretLabel: (id: string, label: string) => patch(`/api/secrets/${id}`, { label }),
  deleteSecret: (id: string) => fetch(`/api/secrets/${id}`, { method: "DELETE" }).then(json),
  /** State of the project's own session image on each docker runner, `null` if it declares none.
   *  The gesture next to it: `rebuildSessionImage`. */
  sessionImageState: (projectId: string): Promise<{ runners: ProjectImageRunner[] | null }> =>
    fetch(`/api/projects/${projectId}/session-image`).then(json),
  rebuildSessionImage: (projectId: string, runnerId: string): Promise<{ logPath: string }> =>
    post(`/api/projects/${projectId}/session-image/rebuild`, { runnerId }),
};
