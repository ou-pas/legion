// session-spec: the contract the container receives, written on the side that reads it.
//
// The spec is built by the control plane (`server/src/sessions/runner/types.ts`, `SessionSpec`) and
// consumed here. Until batch 10 it arrived as untyped `spec.xxx`: renaming a field on the server
// broke the payload silently, the class of bug `make contract` exists for between screen and API.
//
// Not a copy of the server type, and it must not become one: `runner-payload/` may import nothing
// from `server/` (dependency-cruiser rule `runner-payload-has-no-server-imports`). It is the payload's
// view: the fields it reads, and only those.
//
// A type test stitches the halves together: `server/src/sessions/runner/payload-spec.test.ts` checks
// the server's `SessionSpec` is assignable to this one. That is the right direction: the server must
// provide everything the container reads, with the same names and shapes. A renamed field fails at
// the type gate, not at the first session.

/** A repository granted to the agent, cloned into `./repos/<name>`. `credential` carries the name of
 *  the environment variable holding the token, never the token. */
export type RepoGrant = {
  name: string;
  url: string;
  access: "read" | "write";
  testCommand?: string | null;
  forge?: "github" | "gitlab";
  credential?: { username: string; tokenEnv: string };
};

/** A project rule, already rendered by the server (`prepareRules`). `locked` marks what no
 *  repository file can override. */
export type SpecRule = {
  name: string;
  head: string;
  file: string | null;
  /** v60: the path to write the body to, distinct from `file`, the path cited in the prompt; they
   *  diverge as soon as a rule has globs. Optional because server and image deploy separately and a
   *  pre-v60 server only sends `file`, which `?? r.file` in `capabilities.mts` catches. */
  diskPath?: string | null;
  body: string | null;
  locked: boolean;
};

/** A granted skill, written by the runner into `<workdir>/.claude/skills`. */
export type SpecSkill = { name: string; files: { path: string; b64: string }[] };

export type SessionSpec = {
  sessionId: string;
  callbackUrl: string;
  callbackToken: string;
  taskId: string;
  taskName: string;
  taskDescription: string;
  agentName: string;
  rolePrompt: string;
  goalId: string | null;
  model: string;
  /** Reasoning effort (v17), five steps. `null` = nothing set, the SDK decides. */
  effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  /** Extended thinking (v17). `null` = nothing set. */
  thinking:
    | { type: "adaptive" }
    | { type: "enabled"; budgetTokens?: number }
    | { type: "disabled" }
    | null;
  repos: RepoGrant[];
  repoBranch: string;
  gitAuthor: { name: string; email: string };
  /** The final commit's subject when the session only made checkpoints, computed on the server so
   *  the naming rule is not duplicated here. */
  fallbackCommitSubject: string;
  /** `allowedTools` skips confirmation (SDK option of the same name); `builtinTools` restricts (option
   *  `tools`). Both are computed on the server from grants. */
  allowedTools: string[];
  builtinTools: string[];
  inboxEnabled: boolean;
  artifactsPath: string;
  expectedArtifacts: string[];
  /** The event number this container counts from (a session spans several containers). Zero on
   *  first launch. */
  seqBase: number;
  mock: boolean;
  env: Record<string, string>;
  browser: { service: string; network: string } | null;
  mcpServers: Record<string, unknown>;
  skills: SpecSkill[];
  rules: SpecRule[];
  /** Present on a resume after an inbox answer. */
  resume: { sdkSessionId: string; prompt: string } | null;

  // Not sent by the server, yet read by the payload. Optional because they are absent from the
  // server's spec, measured in batch 10 (10/09). Typing them so freezes the state without fixing it
  // (the batch changed no behaviour; the finding was filed as tasks). Do not make them required
  // without checking the server sets them.
  /** Single-repository compatibility from before v7 (`repo-grants.mts`). */
  repoUrl?: string | null;
  repoAccess?: "read" | "write" | "none";
  /** Turn budget thresholds (`turn-budget.mts`), announced as settable by the spec and never set:
   *  the module's defaults always apply. */
  turnWarnAt?: number;
  turnPauseAt?: number;
};
