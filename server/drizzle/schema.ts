// Legion domain schema. The migrations that build it live in server/src/shared/migrations/.
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  defaultModel: text("default_model").notNull().default("sonnet"),
  repoUrl: text("repo_url"),
  fsRoot: text("fs_root"), // null → LEGION_DATA/fs/<slug>; otherwise a folder chosen by the operator
  // Living context (v11): architecture, decisions, vocabulary. Injected into the system prompt of
  // every session, editable in the UI, enriched after real tasks.
  context: text("context").notNull().default(""),
  // Demo project (v15): filled with mock data to exercise design and interactions. Read-only: the
  // launch points (runTask, resume, goal loop) start no agent on it.
  demo: integer("demo", { mode: "boolean" }).notNull().default(false),
  // Git identity of agent commits (v19), per project. NULL = sane default (see git-identity.ts).
  // Validated on write (/api/projects routes), never guessed here.
  gitAuthorName: text("git_author_name"),
  gitAuthorEmail: text("git_author_email"),
  // Complexity → model routing, per project (v24). JSON {low?, med?, high?}; a missing or empty key
  // falls back to the project default (models/model.ts:resolveModel). Backfilled with the former
  // hard-coded behaviour so nothing changed silently.
  modelRouting: text("model_routing").notNull().default('{"low":"haiku","high":"opus"}'),
  // v35: skills active by default across the project. JSON string[] of folder names.
  //
  // Not a `skills` table: a skill is a folder on disk (`LEGION_DATA/skills/<name>/SKILL.md`). A table
  // would describe it a second time and need resyncing, with the usual drift (a folder without a row
  // is invisible, a row without a folder is a ghost). What is stored is a choice about a skill, which
  // belongs to the project like `modelRouting` and `chainBindings`.
  //
  // Resolution is additive: the agent inherits this list and may add more. A name with no folder is
  // ignored at delivery, as for agent skills.
  defaultSkillNames: text("default_skill_names").notNull().default("[]"),
  // v29: role → agentId mapping for chains (per-project override of the catalog). A step's role is
  // `step.role ?? step.agentName`; without a mapping, falls back to the catalog agent by name. Same
  // cascade and JSON shape as model_routing. Resolved when a chain is instantiated, never re-resolved
  // mid-run (templates.ts:resolveStepAgent).
  chainBindings: text("chain_bindings").notNull().default("{}"),
  // v40: how this project's sessions run, i.e. what its code builds with and how it is reached.
  //
  // `session_image`: NULL = the control plane default (`LEGION_SESSION_IMAGE`). The shipped image is
  // node and runs neither `pest` nor `pytest`; before this, the only option was growing everyone's image.
  //
  // `ssh_key_path`: a path on the docker host, never the key. The key does not enter the database, a
  // crate or the screen; the control plane mounts the file read-only into the container. On a remote
  // runner (`ssh://`) it is the path on that machine, which the screen says because a wrong local path
  // fails silently there.
  sessionImage: text("session_image"),
  // v67: the pasted Dockerfile, next to the tag it builds (09/09, after #139/#140: cloning the project
  // repository on the docker host to read `.legion/Dockerfile` was the costliest path of the batch, for
  // what is a thin layer on `legion-session:latest`). NULL = build nothing beyond the declared image.
  // An operator setting like `session_image`: exported in crates, never reviewed like versioned code.
  sessionDockerfile: text("session_dockerfile"),
  sshKeyPath: text("ssh_key_path"),
  // v47: the chosen hue. NULL = derived from the name/id (slice nav/02), the default that must never be
  // lost: a new project has its mark with nobody doing anything. A rank on the twelve-step scale of
  // `web/src/ui/tokens.css`, not a colour, so the palette can change without touching this table.
  hue: integer("hue"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Outgoing webhooks (v11): POST {event, payload, ts} to each enabled URL. The global kill switch
// lives in settings (key `notifications`).
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events").notNull().default("[]"), // JSON string[]; empty = every event
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Agent library (v11): an agent promoted to a template can be re-instantiated in any project. Only
// the role and settings travel; fs/env grants stay per project.
export const agentTemplates = sqliteTable("agent_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  title: text("title").notNull().default(""),
  model: text("model"),
  rolePrompt: text("role_prompt").notNull(),
  allowedTools: text("allowed_tools"),
  repoAccess: text("repo_access", { enum: ["none", "read", "write"] }).notNull().default("none"),
  inboxAccess: integer("inbox_access", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Chain library (v18), the counterpart of `agent_templates`. A chain promoted here is offered on every
// project; installing copies it into the target project's `task_templates`, creating missing step
// agents (catalog.ts). Built-in chains (compound-engineer, bugfix) are not here: they live in code so a
// deletion never resurrects them.
export const chainTemplates = sqliteTable("chain_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  steps: text("steps").notNull(), // JSON TemplateStep[]
  autoRunNext: integer("auto_run_next", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Pre-review (v32): comments anchored on the diff of a task's branch. Collected offline, sent in one
// gesture: a block injected into the description and a rerun on the same branch (`taskBranch` is
// stable). No FK to tasks: purge.ts removes them with the task.
export const reviewComments = sqliteTable("review_comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  repoName: text("repo_name").notNull(),
  filePath: text("file_path").notNull(),
  /** Diff side (v33): "new" (right) or "old" (left, a deleted line). A number alone is ambiguous:
   *  deleted line 74 and added line 74 are different lines, and the screen used to confuse them. */
  side: text("side", { enum: ["old", "new"] }).notNull().default("new"),
  /** First line of the commented range (v33). NULL = single-line comment. The anchor stays `line`
   *  (the last one), as on GitHub. */
  startLine: integer("start_line"),
  /** Anchor line number, on the side above. */
  line: integer("line").notNull(),
  /** The targeted line, frozen when commenting: if the branch moves, the comment still says what it
   *  was about. */
  excerpt: text("excerpt").notNull().default(""),
  body: text("body").notNull(),
  status: text("status", { enum: ["open", "sent"] }).notNull().default("open"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

// In-app notices (v14): informational messages tied to no session (e.g. the standup when Discord is
// not configured). Shown on the Inbox page, can be marked read.
export const notices = sqliteTable("notices", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("info"),
  body: text("body").notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Control plane trace (v20, 20/08), distinct from `notices` (human, read/unread, low volume). It holds
// the server's operational reasoning (boot, applied migration, seed, preflight refusal, queueing,
// orphan recovery, integration failure) that used to go to console.log and vanish with the terminal.
// Single writer: `logControlEvent`; rotation: CONTROL_EVENTS_RETENTION (both in shared/db.ts).
export const controlEvents = sqliteTable("control_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  level: text("level", { enum: ["info", "warn", "error"] }).notNull().default("info"),
  source: text("source").notNull(), // e.g. "db", "seed", "preflight", "queue", "recover", "integration"
  message: text("message").notNull(),
  payload: text("payload"), // JSON string | null, optional structured detail
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Template = ordered steps instantiated as a chain of tasks (step N+1 blocked by N).
// Steps are JSON: [{ name, agentName, prompt, approvalGate, expectedArtifacts: string[] }]
export const taskTemplates = sqliteTable("task_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  steps: text("steps").notNull(), // JSON
  autoRunNext: integer("auto_run_next", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Network policy attached to agents. "limited" = egress only to allowedHosts,
// enforced by a per-session proxy sidecar, never by the prompt.
export const environments = sqliteTable("environments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  networking: text("networking", { enum: ["open", "limited"] }).notNull().default("open"),
  allowedHosts: text("allowed_hosts").notNull().default("[]"), // JSON string[]
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  model: text("model"), // null → project.defaultModel (routing: step/task → agent → project)
  // Effort and thinking (v17): two axes separate from the model, as the SDK exposes them. NULL = set
  // nothing and let the SDK decide, so a setting the next model reads differently is not frozen here.
  effort: text("effort", { enum: ["low", "medium", "high", "xhigh", "max"] }),
  thinking: text("thinking", { enum: ["adaptive", "enabled", "disabled"] }),
  /** Used only with thinking = 'enabled' (fixed budget, older models). */
  thinkingBudget: integer("thinking_budget"),
  rolePrompt: text("role_prompt").notNull(),
  runnerPreference: text("runner_preference"),
  environmentId: text("environment_id").references(() => environments.id), // null → open
  // Least privilege — everything below defaults to "nothing":
  fsGrants: text("fs_grants").notNull().default("[]"), // JSON [{folderPath,canRead,canWrite,canDelete}]
  allowedTools: text("allowed_tools"), // JSON string[] | null → safe default set
  envSecretNames: text("env_secret_names").notNull().default("[]"), // JSON string[] — secrets injected as env
  repoAccess: text("repo_access", { enum: ["none", "read", "write"] }).notNull().default("none"),
  inboxAccess: integer("inbox_access", { mode: "boolean" }).notNull().default(true),
  // v30: access to the runner's shared browser (UI checks). BROWSER_WS_ENDPOINT is injected only when
  // this grant is set; never by default.
  browserAccess: integer("browser_access", { mode: "boolean" }).notNull().default(false),
  mcpServerIds: text("mcp_server_ids").notNull().default("[]"), // JSON string[] → mcp_servers.id
  skillNames: text("skill_names").notNull().default("[]"), // JSON string[] → folders of data/skills
  ruleIds: text("rule_ids").notNull().default("[]"), // JSON string[] → rules.id (on top of allAgents rules)
  repoNames: text("repo_names").notNull().default("[]"), // JSON string[] → granted repos.name (v7)
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Repositories, several per project. Access is granted per agent through agents.repoNames; the mode
// (read/write) stays agents.repoAccess.
export const repos = sqliteTable("repos", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(), // short, stable; the clone lives in ./repos/<name>
  url: text("url").notNull(),
  // The forge hosting this repository (v29). Declared, not guessed: a self-hosted GitLab is not
  // `gitlab.com`, and the forge decides which token is presented to git and which review API is
  // queried. `null` = unknown; see effectiveForge in integrations/forge.ts for how it resolves.
  forge: text("forge"), // "github" | "gitlab"
  // v54: id of the webhook created on the forge (03/09). NULL = never connected. The id rather than a
  // boolean, because it is what lets us check or delete the hook on the forge side.
  webhookId: text("webhook_id"),
  // The URL this hook calls. When the instance's public URL changes, it is what lets the screen say
  // "reconnect" instead of an unverifiable "connected".
  webhookUrl: text("webhook_url"),
  testCommand: text("test_command"), // v11: run by the agent before pr.md, results in the body
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Rules: standing instructions injected into the sessions' system prompt (skills, by contrast, are
// invocable know-how). allAgents=true → every agent of the project; otherwise ticked per agent
// (agents.ruleIds).
export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  content: text("content").notNull(),
  allAgents: integer("all_agents", { mode: "boolean" }).notNull().default(false),
  // "suggested" = proposed by memory (human correction → rule), awaiting approval (v10)
  status: text("status", { enum: ["active", "suggested"] }).notNull().default("active"),
  // v41: the full reasoning is in `capabilities/rule-scope.ts`; here, only what the columns mean.
  //
  // `repo_names`: JSON string[]. Empty = applies whatever the repositories (historical behaviour, the
  // migration default). Non-empty = only enters a session whose agent holds one of them. Without it,
  // "all agents" is unusable in a two-repository project.
  //
  // `summary`: empty = the rule is short and its `content` goes whole into the prompt. Non-empty = the
  // prompt carries the summary and `content` is placed in the session workspace to be read when needed.
  repoNames: text("repo_names").notNull().default("[]"),
  summary: text("summary").notNull().default(""),
  // v42: the lock. A `.claude/rules/*.md` file in a cloned repository replaces the rule of the same name
  // (operator decision, 27/08: for a convention the versioned file is authoritative). Except when
  // locked: anyone who can push, agents included, writes repository files, so without the lock an agent
  // could loosen its own leash by committing a rule file. Off by default; set only on rules meant to
  // constrain.
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  // v60: when the rule applies (`repo_names` says where, `all_agents`/`rule_ids` say for whom). JSON
  // `string[]` of globs, in the grammar of Claude Code's `paths:` frontmatter so the value reaches the
  // workspace file untranslated.
  //
  // Empty = always applies, the default, so existing rules migrate without their prompt changing a
  // byte. Non-empty = enters context only when the session opens a matching file, but only under the
  // SDK's native loading, which the runner still disables. The field deliberately precedes its effect
  // (see migration v60).
  paths: text("paths").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// External MCP server registry, per project. config = JSON in the SDK shape (http/sse:
// {type,url,headers?}; stdio: {type,command,args?,env?}). Values may reference a project secret as
// ${SECRET:NAME}, resolved in buildSpec, never stored in clear.
export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(), // server name on the SDK side (tools = mcp__<name>__*)
  config: text("config").notNull(), // JSON
  allowedHosts: text("allowed_hosts").notNull().default("[]"), // JSON string[], added to the proxy on limited networking
  // v35: the same box as rules. An MCP server is a capability (it adds an ability), not an access (it
  // gives no data by itself), which is what allows a project default; a secret or a repository never
  // gets one.
  allAgents: integer("all_agents", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const runners = sqliteTable("runners", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: ["docker", "process"] }).notNull(),
  dockerHost: text("docker_host"),
  maxConcurrentSessions: integer("max_concurrent_sessions").notNull().default(3),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // v38: session resources, per machine (26/08). `--memory=1g --cpus=1` was hard-coded in `docker.ts`,
  // and 1 GB made the repository's own instructions impossible: a front agent following CLAUDE.md runs
  // Storybook and Playwright, the kernel killed the runtime, and the session reported "code 1".
  // Per runner because that is where machines differ. The default stays 1 GB so no existing session
  // changed at migration.
  memoryMb: integer("memory_mb").notNull().default(1024),
  cpus: real("cpus").notNull().default(1),
  // v51: the address this runner's containers call back. `LEGION_CALLBACK_URL` is global and cannot be
  // right for two machines: a container on the Mac mini calling `localhost` reaches the Mac mini, not
  // the control plane. NULL = the global variable, then `http://localhost:<port>`.
  callbackUrl: text("callback_url"),
  // v51: last time its daemon answered. Written by the periodic probe (`infra/probe.ts`), read by
  // `pickRunnerRow`: never route to a sleeping machine. NULL = never answered since declared.
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
});

// Encrypted at rest (AES-256-GCM, master key OUTSIDE the DB — see src/shared/crypto.ts).
export const secrets = sqliteTable("secrets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  ciphertext: text("ciphertext").notNull(), // base64(iv|tag|data)
  // v48: the readable label, next to the ciphertext and never inside it. Inside, listing a project's
  // keys would need the master key, and an unreadable secret would lose its name exactly when you look
  // for the broken one. NULL = never named (the screen shows the variable name), which is not the same
  // as a cleared label.
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  // v74: the refresh token, encrypted like `ciphertext`. NULL = a secret pasted by hand, which Legion
  // cannot renew.
  refreshCiphertext: text("refresh_ciphertext"),
  // v74: what is known about the credential without opening it: plain JSON `{ expiresAt, account,
  // scopes, … }`. Invariant: everything here is readable without the master key, so no secret goes in.
  // Open to keys other integrations attach; a shared bag, not a fixed shape.
  metadata: text("metadata"),
});

// v64: a project's Claude credentials, ordered.
//
// They moved out of `secrets`: `putSecret` upserts by name, so a second token overwrote the first. A
// credential already differed from other secrets (it escapes `envSecretNames` grants, see
// projects/auth.ts), and a rank or exhaustion state makes no sense on `GITHUB_TOKEN`.
//
// The rank alone decides: the first non-exhausted credential wins, alone. Two credentials are never
// injected together, or the SDK would pick and the account charged would depend on its read order.
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  // In practice always `CLAUDE_CODE_OAUTH_TOKEN` (decision of 08/09: the list holds subscription tokens
  // only). The column exists because resolution still knows `ANTHROPIC_API_KEY`, as a fallback outside
  // the ranking.
  name: text("name").notNull(),
  rank: integer("rank").notNull(),
  ciphertext: text("ciphertext").notNull(), // base64(iv|tag|data), same encryption as `secrets`
  // The name the operator gives the account ("Personal", "Work"): the only thing telling two
  // subscription tokens apart on screen, since they share a variable name.
  label: text("label"),
  // Until when this account is exhausted: two columns, not a table per window.
  //
  // The first version had `credential_exhausted (credential_id, window, until)` because three windows
  // (`five_hour`, `seven_day`, `seven_day_opus`) reopen separately. Undone on 08/09: resolution skips an
  // exhausted account without looking at the task's model, so the three windows behaved as one
  // `max(until)`, and exhaustion is only discovered by using an available account, so only one window can
  // be closed at a time. Per-window granularity pays once resolution knows the task's model (a closed
  // weekly Opus window leaves the account fine for Sonnet and Haiku).
  //
  // NULL or past = available. No purge: comparing with the current time does the work.
  exhaustedUntil: integer("exhausted_until", { mode: "timestamp_ms" }),
  // The window that closed the account, a label and not a key. Without it the operator reads a time
  // without knowing whether to wait five hours or six days.
  exhaustedWindow: text("exhausted_window"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  // The rank is the order, so it is unique within a project: two rank 2s would make resolution depend
  // on SQLite's read order.
  uniqueIndex("idx_credentials_project_rank").on(t.projectId, t.rank),
]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // `later` = "Save for later": noted on purpose, committed to nobody. It blocks the automatic paths
  // (queue, scheduler), never the human.
  status: text("status", { enum: ["later", "todo", "doing", "review", "done"] }).notNull().default("todo"),
  // v56: why the task was settled, when an automatic path settled it.
  //
  // `review` is where every ending lands: delivered work, an OOM, an API error, an operator stop, an
  // unmet artifact contract. On 03/09 two failures an hour apart showed the same, most reassuring,
  // display on tasks that had produced nothing.
  //
  // A column, not a sixth status: the status is the operator's intent (the board column), this is the
  // server's finding. Mixing them would force the queue, drag and drop and the editability predicates
  // to know a state that does not concern them. Settling a failure in `todo` to make it "rerunnable"
  // would be a trap: `todo` is the queue, and a persistent 529 would loop (manager.ts, no automatic
  // retry).
  //
  // A code, not a sentence: the text belongs to the screen's catalog. The sentence already exists in
  // `sessions.end_reason`.
  //
  // `null` is frequent and meaningful: the agent settled the task itself (`update_task`), or no
  // automatic path ever settled it. It separates "it finished and said so" from "we saw it end".
  settledOutcome: text("settled_outcome", { enum: ["delivered", "empty", "failed", "stopped"] }),
  // v21: fractional rank within its board column (drag and drop), ascending = top. Moving a card only
  // touches its rank (and rarely its target column's on rebalance), never a global resequencing. See
  // task-move.ts.
  boardOrder: real("board_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false), // done tasks moved off the board
  // v12: complexity routes the model (low→haiku, high→opus, med→fallback chain). modelOverride wins.
  complexity: text("complexity", { enum: ["low", "med", "high"] }).notNull().default("med"),
  // v13: priority orders task pickup (automatic queue, goal spawns, board, scheduler).
  priority: text("priority", { enum: ["low", "med", "high"] }).notNull().default("med"),
  // v13: queued. A launch at full capacity queues the task (todo) instead of failing; pumpQueue()
  // starts it when a slot frees. Drafts never launched are not queued.
  queued: integer("queued", { mode: "boolean" }).notNull().default(false),
  prUrls: text("pr_urls").notNull().default("[]"), // JSON [{repo,url}], PRs created from pr.md (v8)
  externalRef: text("external_ref"), // JSON {provider,issueId,identifier,url}, linked issue (v9)
  assigneeAgentId: text("assignee_agent_id").references(() => agents.id),
  modelOverride: text("model_override"),
  approvalGate: integer("approval_gate", { mode: "boolean" }).notNull().default(false),
  // v53: read-only task. The session spec clones repositories with `access: "read"` whatever the
  // agent's grant (runner/manager.ts, buildSpec). Everything that pushes is already guarded by
  // `access === "write"` in the container, so no checkpoint, catch-up commit, push or automatic PR.
  // Born from the Kopee canary task (02/09): "push NOTHING" in the brief still ended as an MR of
  // regenerated lockfiles, because an instruction does not hold the guardrails and a grant does.
  readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
  goalId: text("goal_id"), // set when the task was spawned by a goal's orchestrator
  // Chains (template runs): a task blocked by its predecessor cannot run until it is done.
  templateId: text("template_id"), // for autoRunNext lookup (review P3 #6)
  templateRunId: text("template_run_id"),
  stepIndex: integer("step_index"),
  expectedArtifacts: text("expected_artifacts").notNull().default("[]"), // JSON string[]
  stepPrompt: text("step_prompt"), // per-step instructions appended to the task description
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }), // one-shot scheduling
  // v25: task proposals by an agent (MCP `propose_task`, task-propose.ts): work found outside its scope
  // is filed instead of lost in its report. Always created in `later`, never assigned. These four
  // columns only trace provenance for the screen; nothing here drives an automatic path.
  proposedByAgent: integer("proposed_by_agent", { mode: "boolean" }).notNull().default(false),
  proposedBySessionId: text("proposed_by_session_id"), // session that called propose_task
  proposedFromTaskId: text("proposed_from_task_id"), // task that session was running
  proposedAgentName: text("proposed_agent_name"), // suggested target agent, never an assignment
  // v46: the contract written ahead for a breakdown slice. JSON `{ validatedBy, items: [{ text, mode,
  // edge? }] }`, read by `tasks/criteria.ts`. NULL = none. A task carrying one is a gated step: its
  // agent cannot mark it done.
  criteria: text("criteria"),
  // v50: kind of work in the conventionalbranch.org sense, proposed by the classifier
  // (`tasks/task-classify.ts`) at creation. Only used to name the branch. `chore` is the default and
  // the fallback when unsure: a doc fix under `feature/` lies more than a cautious `chore/`.
  type: text("type", { enum: ["feature", "bugfix", "chore"] }).notNull().default("chore"),
  // v50: the branch, fixed at its first derivation (`tasks/lifecycle.ts:taskBranch`). Stored rather
  // than derived on read because it depends on the task name, which can be renamed (`task-edit.ts`):
  // a recomputed branch would orphan work already pushed. NULL = not requested yet, not "no branch".
  branch: text("branch"),
  // v66: the machine the operator chose for this task. NULL, the default, lets the control plane choose
  // (health, capacity, disk, load; `sessions/runner/manager.ts`). A value is a hard choice: the queue
  // routes only there and refuses, naming the machine, if it is down, rather than falling back, which
  // would cancel the gesture. `agents.runner_preference`, by contrast, is soft.
  //
  // Applies to the next sessions only: a running session keeps the `runnerId` it reserved
  // (`sessions.runner_id`).
  chosenRunnerId: text("chosen_runner_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// v44 (28/08): dependencies are a graph. A task can be blocked by several (a batch's slices all block
// its Wiki step); the former single column held one and v45 removed it. `tasks/blockers.ts` is the only
// writer. `ON DELETE CASCADE` because tasks are also deleted outside `deleteTask` (project purge, a
// goal task never launched): the constraint holds what code forgets.
export const taskBlockers = sqliteTable("task_blockers", {
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  blockerId: text("blocker_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.taskId, t.blockerId] }),
  index("idx_task_blockers_blocker").on(t.blockerId),
]);

export const taskActivity = sqliteTable("task_activity", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  from: text("from", { enum: ["agent", "human", "system"] }).notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  runnerId: text("runner_id").notNull().references(() => runners.id),
  model: text("model").notNull(),
  // `blocked` (slice nav/11): stopped on a decision, not waiting for an answer. `waiting` covered four
  // situations: a question, an approval gate, a task dependency (`waitForTaskId`) and a timed sleep
  // (`wakeAt`). The last two wake on their own and automation may write to them; a gate waits for a
  // human, and writing to it answers in the human's place. Only that distinction became a status: the
  // automatic waits are already told apart by their fields.
  //
  // No migration: the column is TEXT without CHECK since v1 and was never rebuilt; the enum is
  // TypeScript, not SQL. Existing sessions keep their status; which ones were gates is not guessed.
  status: text("status", {
    enum: ["starting", "running", "waiting", "blocked", "committing", "destroyed", "failed"],
  }).notNull().default("starting"),
  callbackToken: text("callback_token").notNull(),
  runtimeHandle: text("runtime_handle"),
  sdkSessionId: text("sdk_session_id"), // needed for resume after an inbox pause
  mock: integer("mock", { mode: "boolean" }).notNull().default(false), // authoritative — never inferred (review #10)
  resumeCount: integer("resume_count").notNull().default(0),
  costUsd: real("cost_usd"),
  eventCount: integer("event_count").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  /** Why the session stopped. Set by markSessionTerminal and nowhere else (v22).
   *  NULL = still alive, or ended before the column existed. */
  endReason: text("end_reason"),
  // v37: a pause requested by the operator (26/08). The pause mechanism already existed as the inbox
  // path (container destroyed, `sdkSessionId` kept, fresh clone on resume), but only the agent could
  // trigger it by asking a question; the operator only had a hard stop.
  //
  // A flag, not a status: the session stays `running` until it stops itself at a turn boundary. An
  // intermediate status would lie, since the agent keeps working and may finish before reading it.
  pauseRequested: integer("pause_requested", { mode: "boolean" }).notNull().default(false),
  // v64: the Claude credential this run uses. Set on every spec build, so rewritten on every resume:
  // after a switch the current account is the one that counts. Without it, an out-of-quota stop would
  // not know which account to mark exhausted, and re-resolving afterwards would bury the wrong one.
  // NULL = mock session, or running on the fallback (project key outside the ranking, control plane
  // environment); neither is ranked, so neither gets exhausted.
  //
  // No `references(credentials.id)`, on purpose, as for `waitForTaskId`: a credential must be removable
  // without tripping on every session that ran on it. A cascade would delete sessions, `SET NULL` would
  // erase their cost attribution.
  credentialId: text("credential_id"),
});

export const sessionEvents = sqliteTable("session_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  // v36: the number given by the runtime, unique per session. `id` is global: it orders but does not
  // say how many events a session produced, so it can neither replay a lost frame nor reject a
  // duplicate. Without it `report()` was an unacknowledged POST, and a container death lost the sentence
  // (fxHi2IpRXo, tCgO0ORtqe, 26/08).
  // NULL on rows before v36 and on events emitted by the control plane itself; a SQLite unique index
  // allows any number of NULLs, which is what is needed here.
  seq: integer("seq"),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Steering (v23): talking to an agent while it works, without stopping it.
//
// The inbox is the agent's channel (it asks, pauses, waits); here the human pushes a message into a
// live session. A queue in the database rather than a direct send, because the control plane opens no
// connection to the runtime: the runtime polls (same callback channel and token as the inbox). The row
// survives a network hiccup, and `delivered_at` says whether the message reached the agent.
export const sessionSteers = sqliteTable("session_steers", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  text: text("text").notNull(),
  /** Who spoke. Always "human" today; the column exists so an orchestrator's message is never
   *  confused with the operator's in the trace. */
  source: text("source").notNull().default("human"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** NULL = never reached the agent (session died first, or still queued). */
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
});

// Goal — open-ended loop: the orchestrator picks the next specialist until the
// human-approved Definition of Done is met, or a safety rail stops everything.
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  request: text("request").notNull(),
  dod: text("dod").notNull().default("[]"), // JSON [{id,text,done}]
  dodApproved: integer("dod_approved", { mode: "boolean" }).notNull().default(false),
  status: text("status", {
    // `cancelled` (v54) = stopped by the operator (kill switch); `failed` is set only by the loop when
    // it breaks (see killGoal).
    enum: ["draft", "active", "paused", "completed", "stopped-stuck", "stopped-budget", "stopped-time", "failed", "cancelled"],
  }).notNull().default("draft"),
  plan: text("plan").notNull().default("[]"), // v11: planned steps [{step,agentName,why}], approved with the DoD
  allowedAgentIds: text("allowed_agent_ids").notNull().default("[]"), // JSON string[] — the pool
  budgetUsd: real("budget_usd"), // null = no $ ceiling (subscription: iteration/duration rails)
  maxDurationMs: integer("max_duration_ms"),
  maxNoProgress: integer("max_no_progress").notNull().default(3),
  spentUsd: real("spent_usd").notNull().default(0),
  noProgressStreak: integer("no_progress_streak").notNull().default(0),
  iterations: integer("iterations").notNull().default(0),
  mock: integer("mock", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
});

export const goalEvents = sqliteTable("goal_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalId: text("goal_id").notNull().references(() => goals.id),
  type: text("type").notNull(), // decision | task_done | rail | status | dod
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// The ONLY human interrupt channel. An open question holds its session in `waiting` (or `blocked`
// for a gate); the human answer resumes it.
export const inboxMessages = sqliteTable("inbox_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  kind: text("kind", { enum: ["text", "choice", "form"] }).notNull(),
  body: text("body").notNull(),
  choices: text("choices"), // JSON [{id,label}] | null
  // v31: form question. Markdown / SVG blocks and typed fields (JSON FormSpec, validated at creation by
  // inbox-form.ts): N questions in one pause instead of a pause → destroy → resume cycle per question.
  // The structured answer goes into `answerText` (JSON).
  form: text("form"), // JSON FormSpec | null
  // The action receipt (item 19 of the 20/08 review). A bare question forces opening the session to
  // decide; these two fields let the operator approve from the list, or from a phone. Optional: an old
  // question, or an agent that leaves them empty, still displays.
  evidence: text("evidence"), // what the agent read to get there
  impact: text("impact"), // blast radius: what the decision will touch
  selectedChoiceId: text("selected_choice_id"),
  answerText: text("answer_text"),
  status: text("status", { enum: ["open", "answered", "closed"] }).notNull().default("open"),
  // v12: what to do with the answer. "resume" (resume the session, default) or "retry-task" (post-failure
  // diagnostic question: the answer reruns the task, never the dead session). `rebuild-image` (12/09) is
  // the third, without migration since SQLite does not constrain the column: the answer rebuilds the
  // missing image and lets the queue pick the task up again, or moves the tasks to "later".
  onAnswer: text("on_answer", { enum: ["resume", "retry-task", "rebuild-image"] })
    .notNull()
    .default("resume"),
  // v26: `wait_for_task`, waiting on a dependency (wait-for-task.ts). A session needing task X first
  // could only finish or disturb the human. This field, and nothing else (no new session status, the
  // pause uses the proven path), says the entry is also answered automatically by `onTaskDone` when X is
  // done. No `references(tasks.id)`, on purpose: the target must be deletable, and the answer to that is
  // a named wake-up ("task X was deleted"), not a cascade.
  waitForTaskId: text("wait_for_task_id"),
  // v68: `request_repo` (09/09), the name of the project repository the agent asks for. Same pattern as
  // `wait_for_task_id`: the entry stays an inbox question (approval, blocked session), and the field says
  // what "grant" must do: add the repository to the agent before resuming (sessions/request-repo.ts).
  // NULL = no answer grants anything.
  grantRepoName: text("grant_repo_name"),
  // Who answered: "human" or "system" (automatic dependency wake-up). NULL = answered before the column
  // existed; no provenance is invented retroactively.
  answeredBy: text("answered_by", { enum: ["human", "system"] }),
  // v28: scheduled wake-up. An open entry with this time is woken by the scheduler (`answered_by:
  // system`); the human can still answer first. Set by the out-of-quota pause (quota-pause.ts);
  // NULL = ordinary question.
  wakeAt: integer("wake_at", { mode: "timestamp_ms" }),
  // v57: why this wait. Most reasons were derivable from the fields above (dependency, scheduled
  // wake-up, approval, diagnostic), but an operator-requested pause looked like any question and was
  // announced as "an agent is asking you a question" for a stop you had just requested.
  //
  // Stored on the entry, not the session: a session goes through several waits, an entry holds exactly
  // one. The rule and values live in `inbox/wait-reason.ts`. NULL = entry created before the column;
  // the reason is then derived from the fields.
  //
  // Values added later need no migration, since SQLite does not constrain the column: `update-pause`
  // (08/09), a session suspended across an update restart; `turn-relaunch` (10/09), a session that hit
  // its turn budget while progressing, pushed and relaunched alone in a fresh container
  // (`sessions/turn-relaunch.ts`). It borrows the quota pause's scheduled wake-up, hence its own reason:
  // otherwise the resume prompt would describe a quota window that never closed.
  reason: text("reason", {
    enum: [
      "question",
      "approval",
      "dependency",
      "quota-pause",
      "operator-pause",
      "update-pause",
      "diagnostic",
      "turn-relaunch",
    ],
  }),
  telegramMessageId: integer("telegram_message_id"),
  // v62 (07/09): a round's draft. A six-question form is not always filled in one go; without it,
  // leaving the page lost everything, which pushes toward answering fast rather than right.
  //
  // No "partial" status: `status` stays open/answered/closed, and "partially answered" is derived from
  // a draft on an open entry. A new status would force every reader of the column to know a nuance
  // that changes no mechanism.
  //
  // The JSON has the same keys as `answer_text` (the agent's field ids, `__comment` included) but is
  // lax: nothing is required, it describes work in progress. `validateFormDraft`
  // (inbox/inbox-draft.ts) bounds it and `reply` clears it.
  draft: text("draft"), // JSON { fieldId: value } | null
  draftAt: integer("draft_at", { mode: "timestamp_ms" }),
  // v70 (12/09): what the answer must rebuild. Same pattern as `wait_for_task_id` and `grant_repo_name`:
  // the field says what "Rebuild" must do: the missing image, the machine lacking it, and the project,
  // relevant only if the image is the one it declares. NULL = no answer rebuilds anything.
  //
  // Also the dedup key: an open question already carrying this (machine, image) pair forbids a second
  // one. In the database rather than memory so a restarted control plane does not ask again.
  imageRebuild: text("image_rebuild"), // JSON { runnerId, runnerName, image, projectId } | null
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  answeredAt: integer("answered_at", { mode: "timestamp_ms" }),
});

// Scheduled tasks (v39, 26/08). The screen shipped alone in PR #50 and called six routes nobody
// served; these two tables are the missing half.
//
// Not `tasks.scheduled_at`: that field holds a single due time on an already-written task, which
// fires and clears. A schedule is a rule that outlives its firings and produces tasks; conflating them
// would mean recreating the task by hand after each run.
export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  /** Five UTC fields. Validated on write (`schedules/cron.ts`): an unreadable expression is refused at
   *  the door, never stored to fail later in a silent tick. */
  cron: text("cron").notNull(),
  /** The agent receiving the produced task. NULL only when `templateId` takes over. */
  agentId: text("agent_id").references(() => agents.id),
  /** Or: the chain to instantiate. Exclusive with `agentId`. */
  templateId: text("template_id"),
  /** The brief of the produced task, or the request passed to the chain. */
  prompt: text("prompt"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  /** Next due time, computed on write and after each firing. NULL when disabled, or when it never
   *  occurs (`0 0 30 2 *`). The only thing the tick reads: the cron is not re-parsed every round. */
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// The trace of every due time reached, including skipped ones. A schedule that produces nothing is
// indistinguishable from one that does not exist; without these rows "it didn't run last night" has
// no answer.
export const scheduleRuns = sqliteTable("schedule_runs", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull().references(() => schedules.id),
  /** The planned time, not the tick that noticed it: that is what compares to the cron. */
  firedAt: integer("fired_at", { mode: "timestamp_ms" }).notNull(),
  outcome: text("outcome", {
    enum: ["task-created", "skipped-disabled", "skipped-missed", "error"],
  }).notNull(),
  taskId: text("task_id"),
  reason: text("reason"),
});

// v49 (30/08): the concierge's memory. The ephemeral session used to receive the client's history on
// each call: nothing survived a reload, and the browser could rewrite what had been said. The server is
// now the source; `concierge-store.ts` is the only writer.
//
// One table, no conversations table: a conversation is the set of turns carrying its id. Its title is
// read from the first turn and its date from the last, instead of a second table to keep consistent.
export const conciergeTurns = sqliteTable("concierge_turns", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_concierge_turns_conversation").on(t.conversationId, t.createdAt)]);

// v52 (02/09): fleet usage history (operator decision: SQLite rather than Valkey, no new dependency for
// two machines at 2,880 samples a day each).
//
// Two sources, never mixed on screen: `vm` is what `legion-*` containers use inside the Docker VM (the
// capacity sessions care about), `host` is the machine itself, read over ssh (`infra/metrics/`). No
// third source for disk: a threshold is read now and has no trend; its last value lives in memory
// (`infra/metrics/store.ts`), never here.
//
// `cpu`/`mem` are percentages (0-100, NULL if unmeasurable), consumed by the gauge as is.
//
// No index beyond `(runner_id, at)`: two machines at 48 h retention is a few hundred KB, and the purge
// (one DELETE per probe pass) stays negligible without an index on `at` alone.
export const runnerMetrics = sqliteTable("runner_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runnerId: text("runner_id").notNull().references(() => runners.id),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  source: text("source", { enum: ["vm", "host"] }).notNull(),
  cpu: real("cpu"),
  mem: real("mem"),
}, (t) => [index("idx_runner_metrics_runner_at").on(t.runnerId, t.at)]);

// Operator session (v71, 13/09): what authorises the human API, since the address no longer can. An
// agent container on a remote machine egresses through its host and arrives from 100.x,
// indistinguishable from the operator's browser by address.
//
// The guard checks the session, never the token. The token is one way to get a session; `method` says
// which, and already allows `passkey` for when WebAuthn exists.
export const operatorSessions = sqliteTable("operator_sessions", {
  id: text("id").primaryKey(),
  method: text("method", { enum: ["token", "passkey"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  // Refreshed on every authorised request, so the screen can show "this browser, seen two minutes ago"
  // and dormant sessions can be cut if expiry is ever wanted.
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});

// Web Push subscriptions (v72, 13/09): what the browser produces when the operator accepts
// notifications, stored as is.
//
// `endpoint` is the vendor push service URL (Apple, Google, Mozilla) we POST to; `p256dh` and `auth` are
// the keys encrypting the message so that service relays without reading. The endpoint is the natural
// key: a phone reinstalling the home-screen app returns the same endpoint, and without uniqueness it
// would buzz twice.
//
// `events` has the same shape as for webhooks, which decides where push sits in the code: an output of
// `notifyOut`, next to webhooks, not a notifier next to Discord. A notifier receives already-written
// text, never the event name.
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  events: text("events").notNull().default("[]"), // JSON string[]; empty = every event
  // What the operator reads in the list ("Operator's iPhone"). The browser does not say what it is, so
  // the screen suggests a label at subscription time.
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  // Refreshed on every send accepted by the push service. A subscription that received nothing for
  // weeks is either a phone that is off or a row to remove.
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});
