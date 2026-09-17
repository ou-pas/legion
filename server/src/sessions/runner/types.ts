// Runner contract — the 4-method interface from docs/plan.md.
import type { Criteria } from "../../tasks/criteria.js";
import type { RunnerKind } from "../../shared/enums.js";
import type { AgentEffort } from "../../capabilities/agent/agent-enums.js";

export type NetworkPolicy = { mode: "open" } | { mode: "limited"; allowedHosts: string[] }; // enforced by a proxy sidecar
// There is no third mode, and that is a conclusion, not a gap: a session MUST reach the model API
// and the control plane, or it can neither think nor report. "No network access" can only mean
// `limited` with an EMPTY allowlist: the proxy adds those two hosts and refuses the rest.

export type SessionSpec = {
  sessionId: string;
  callbackUrl: string;
  callbackToken: string;
  model: string;
  /** Reasoning effort (v17). `null` = set nothing, the SDK decides. Separate from the model because
   *  they are two axes: the same model does different work depending on effort. */
  effort: AgentEffort | null;
  /** Extended thinking (v17). `budgetTokens` only applies with `enabled` (older models);
   *  `adaptive` lets the model decide when and how much to think. */
  thinking:
    | { type: "adaptive" }
    | { type: "enabled"; budgetTokens?: number }
    | { type: "disabled" }
    | null;
  taskId: string;
  taskName: string;
  /** The final commit title when a session made ONLY checkpoints: `conventionalTitle(branch,
   *  task.name)` (`review/pr-draft.ts`), computed server-side so the naming rule is not duplicated
   *  in the container payload. Read by `checkpoint-squash.mts` through `repos.mts`
   *  (`squashCheckpoints`). */
  fallbackCommitSubject: string;
  taskDescription: string;
  agentName: string;
  rolePrompt: string;
  /** Repositories granted to the agent (multi-repo v7), cloned into ./repos/<name>.
   *  `forge` and `credential` (v29): the container knows NO forge and infers nothing. It receives
   *  the conventional user name to write into the credential store and the NAME of the environment
   *  variable that will carry the token, never the token itself, which comes through the secrets
   *  channel like the others. */
  repos: {
    name: string;
    url: string;
    access: "read" | "write";
    testCommand?: string | null;
    forge?: "github" | "gitlab";
    credential?: { username: string; tokenEnv: string };
  }[];
  /** Shared branch for the whole run/goal — state travels through git, not containers. */
  repoBranch: string;
  /** Commit git identity (v19), resolved server-side from the project (`resolveGitAuthor` in
   *  git-identity.ts), validated on write, never guessed in the container. */
  gitAuthor: { name: string; email: string };
  allowedTools: string[]; // computed SERVER-SIDE from the agent's grants — least privilege
  // The same grants, reduced to BUILT-IN tools, plus the harness plumbing. This list restricts
  // (the SDK's `tools` option); `allowedTools` only waives a confirmation that `dontAsk` never
  // asked for. See capabilities/tool-grants.ts.
  builtinTools: string[];
  inboxEnabled: boolean;
  artifactsPath: string; // run-shared folder, granted rw for this session
  expectedArtifacts: string[]; // the step's artifact contract (enforced by the API)
  /** Files the OPERATOR attached to the brief (`tasks/attachments.ts`), under
   *  `<artifactsPath>/attachments/`. As DATA, like `criteria` and for the same reason: the brief
   *  mentions them in words, but a runtime rereading a paragraph to know which files await it would
   *  go the wrong way. Empty = no attachment, never `null` (a list iterates, a `null` gets tested). */
  attachments: {
    name: string;
    mimeType: string;
    kind: "text" | "image" | "binary";
    size: number;
    path: string;
  }[];
  /** v46: the task's contract WRITTEN AHEAD, its validation command and one to three typed
   *  criteria. `null` = the task has none.
   *
   *  The brief already carries the TEXT (`renderCriteria`, after the description); the spec carries
   *  the STRUCTURE, because a runtime re-parsing a markdown block to know what it must prove is
   *  exactly the wrong direction. */
  criteria: Criteria | null;
  /** This task's LAST batch refusal, as written in its thread, or `null`. Only on a step approving
   *  a batch, and only after a refusal: it is what the relaunched slicer must fix, and without it it
   *  would drop the same artifact again. The brief already carries the TEXT, as for criteria. */
  lotRefusal: string | null;
  goalId: string | null; // set when spawned by a goal's orchestrator
  network: NetworkPolicy;
  /** Host directory persisted across pause/resume cycles (mounted as CLAUDE_CONFIG_DIR). */
  claudeStateDir: string;
  /** D13: the session's WORKING directory (`/workspace`), one per session, persisted across pauses
   *  like `claudeStateDir`. It is why a wake-up fetches instead of re-cloning, and why
   *  `node_modules` is still there. */
  workspaceDir: string;
  /** D14: the package cache SHARED by all sessions, mounted on `/pkg-cache` by the docker runner.
   *  It addresses D13's pain on the FIRST run, where a kept workspace can do nothing. Ignored by the
   *  process runner, which runs on the host and already uses the user's store. `null` = mount
   *  nothing. */
  packageCacheDir: string | null;
  /** v40: this session's image. `null` = the control plane's default image.
   *
   *  It comes from the PROJECT, which knows what its code builds with: node does not run `pest`,
   *  and growing the shared image for one PHP repository makes every other one pay. Ignored by the
   *  process runner, which has no image. */
  image: string | null;
  /** v40: the SSH key path, on the docker host. `null` = no key, no mount.
   *
   *  Not a secret in the `env` sense: the key's value never enters the database or the spec. The
   *  control plane mounts the FILE read-only, and the container copies it at 0600 into `agent`'s
   *  HOME: ssh refuses a key whose uid is not its own, and a bind mount carries the host's uid. */
  sshKeyPath: string | null;
  /** v40: the `known_hosts` next to the key, when it exists. Mounted like it, read-only, and copied
   *  by the entrypoint.
   *
   *  It adds trust ON TOP of the image's, not instead: github.com and gitlab.com fingerprints are
   *  baked in as a floor; this file covers what the image cannot know (self-hosted GitLab, internal
   *  forge) without rebuilding it. `null` = nothing beyond the floor. */
  sshKnownHostsPath: string | null;
  /** Present on a resume run after an inbox answer. */
  resume: { sdkSessionId: string; prompt: string } | null;
  /** The event number THIS container starts counting from: what the server already heard from
   *  this session (`ackOf`). Zero at first launch.
   *
   *  In the spec because `seq` is unique per SESSION and a session spans several containers:
   *  without it a resumed container renumbers from 1, the server refuses every number as a
   *  duplicate, and the refusal looks like an ack from the container's side. Its whole log is lost
   *  silently. See the counter header in `runner-payload/session-runner.mts`. */
  seqBase: number;
  mock: boolean;
  /** Credentials + granted secrets. Set by the session-runner in ITS environment from the spec,
   *  never as `-e` on the container, where `docker inspect` read them. */
  env: Record<string, string>;
  /** The runner's SHARED browser (v30), set ONLY if the agent has the `browserAccess` grant AND the
   *  runner is docker. Docker provisioning ensures the service runs, then connects the session
   *  container to the service's INTERNAL network; `BROWSER_WS_ENDPOINT` is already in `env`.
   *  `null` = no browser. */
  browser: { service: string; network: string } | null;
  /** External MCPs granted to the agent (Phase 5b): SDK configs, secrets already resolved. */
  mcpServers: Record<string, unknown>;
  /** Granted skills (Phase 5b), written by the runner into <workdir>/.claude/skills. */
  skills: { name: string; files: { path: string; b64: string }[] }[];
  /** v42: the project's rules AS IS, because the prompt's `## Rules` section is rendered in the
   *  container, no longer here.
   *
   *  A direct consequence of merging with the repositories' `.claude/rules/*.md`, which only exist
   *  after the clone. A server that had already written its half of the prompt could not remove it
   *  when a file replaces it, and the model would read two contradicting texts.
   *
   *  `head`/`file`/`body` come from `prepareRules`; `file` is RELATIVE to the workdir and computed
   *  server-side because the prompt QUOTES it: two derivations of the same accented name would
   *  diverge, and the agent would read a path that does not exist. `locked` marks what no repository
   *  file may replace. */
  rules: {
    name: string;
    head: string;
    file: string | null;
    body: string | null;
    locked: boolean;
  }[];
};

export type RunnerHandle = { id: string; runtime: string };

export interface Runner {
  readonly kind: RunnerKind;
  provision(spec: SessionSpec): Promise<RunnerHandle>;
  /** Resolves when the runtime exits; events flow via HTTP callbacks, not this interface.
   *
   *  `oomKilled` (26/08): the kernel killed the runtime for lack of memory. Without it, a session
   *  killed by the container limit reports "code 1", which says nothing and which the automatic
   *  diagnostic then misreads (seen: "lint timeout" where three dev servers ran in 1 GB). The Docker
   *  runner KNOWS: `State.OOMKilled`. */
  wait(handle: RunnerHandle): Promise<{ exitCode: number; oomKilled?: boolean }>;
  destroy(handle: RunnerHandle): Promise<void>;
}
