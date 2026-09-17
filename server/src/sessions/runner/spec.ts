// What the container receives: the `SessionSpec`, and the checks that precede it.
//
// Split out of `manager.ts` (lot 11). The text the agent reads lives next door in `brief.ts`: here
// we ASSEMBLE (tools, secrets, repositories, network, browser, resume), we do not write prose.
import fs from "node:fs";
import path from "node:path";
import { decryptSecret } from "../../shared/crypto.js";
import { conventionalTitle } from "../../review/pr-draft.js";
import { ackOf } from "../../shared/events.js";
import { taskBranch } from "../../tasks/lifecycle.js";
import { artifactsPath } from "../../tasks/artifacts/scope.js";
import { taskAttachments } from "../../tasks/attachments.js";
import { parseCriteria } from "../../tasks/criteria.js";
import { lastLotRefusal } from "../../chains/lot-refusal.js";
import { blockerMessage, repoBlockers, type RepoGrant } from "../preflight.js";
import { credentialFor, effectiveForge } from "../../integrations/forge.js";
import { sessionCredentialEnv } from "../session-credential.js";
import {
  packSkills,
  resolveMcpServers,
  resolveRules,
  resolveSkillNames,
} from "../../capabilities/capabilities.js";
import {
  CORE_MCP_TOOLS,
  HARNESS_TOOLS,
  INBOX_GATED_TOOLS,
  resolveAgentTools,
  resolveBuiltinTools,
} from "../../capabilities/tool-grants.js";
import { browserNames, wsEndpoint } from "./browser-service.js";
import { PACKAGE_CACHE_DIR, workspaceDir } from "./workspace.js";
import { resolveGitAuthor } from "../../projects/git-identity.js";
import { inspectSshKey, knownHostsBesideKey } from "../../projects/session-runtime.js";
import type { NetworkPolicy, SessionSpec } from "./types.js";
import { NETWORKING, REPO_ACCESS, RUNNER_KIND, type RepoAccess } from "../../shared/enums.js";
import { AGENT_THINKING } from "../../capabilities/agent/agent-enums.js";
import { buildRolePrompt, buildTaskBrief, capabilityNotes } from "./brief.js";
import { logControlEvent } from "../../events/control-log-store.js";
import {
  agentRow,
  environmentRow,
  projectRow,
  reposOfProject,
  type AgentRow,
  type ProjectRow,
  type TaskRow,
  secretNamesOfProject,
  secretsNamed,
  taskRow,
} from "./manager-store.js";

const DATA_ROOT = path.resolve(process.env.LEGION_DATA ?? "data");

/** An agent's network policy. Without an environment: NO restriction.
 *
 *  This default went back and forth on the same day (25/08), and the reasoning deserves writing
 *  down once. In the morning the default went from open to wall: the product promised least
 *  privilege and the runtime did the opposite. In the evening, operator's decision: network limits
 *  are removed for now.
 *
 *  What tipped it: the wall does not protect "the agents", it protects the SECRETS they carry. Six
 *  agents out of seven carried a write PAT, three also carried a Linear key none of their tools
 *  used, and the agent most walled in by the switch (`librarian`) was the only one carrying
 *  nothing. A wall aimed beside what it protects costs blocked work without buying safety, and it
 *  prevented giving web tools to agents whose job is reading and summarising.
 *
 *  So the wall is NOT removed: it becomes an explicit choice, set on the agent through its
 *  environment. What disappears is the wall by omission. The rule worth having is still to be
 *  written and will tie both: an agent carrying a secret should not combine free egress with
 *  reading unknown content. It awaits a decision, not this file. */
export function buildNetworkPolicy(agent: AgentRow): NetworkPolicy {
  if (!agent.environmentId) return { mode: "open" };
  const env = environmentRow(agent.environmentId);
  // Missing environment = no environment. One rule to keep in mind: without a RESOLVED, limited
  // environment, nothing restricts.
  if (!env || env.networking === NETWORKING.open) return { mode: "open" };
  return { mode: "limited", allowedHosts: JSON.parse(env.allowedHosts) as string[] };
}

/** The session's EFFECTIVE right on its repositories: the agent's, lowered to "read" by a
 *  read-only task (v53). ONE rule, read by preflight AND by the spec: two copies would diverge one
 *  day, and preflight would refuse a session the spec had accepted. */
export function effectiveRepoAccess(task: TaskRow, agent: AgentRow): "none" | "read" | "write" {
  const access = agent.repoAccess as "none" | "read" | "write";
  return task.readOnly && access === "write" ? "read" : access;
}

function grantedSecrets(agent: AgentRow, projectId: string): Record<string, string> {
  const names = JSON.parse(agent.envSecretNames) as string[];
  if (names.length === 0) return {};
  return Object.fromEntries(
    secretsNamed(projectId, names).map((r) => [r.name, decryptSecret(r.ciphertext)]),
  );
}

/** Shared browser (v30): a PURE decision, made here and never in provisioning. Requires the
 *  `browserAccess` grant AND a docker runner (a ProcessRunner has no docker network to offer: the
 *  session runs without a browser, without an error, as before the grant). */
export function browserForSession(
  agent: { browserAccess: boolean },
  runnerRow: { id: string; kind: string },
): SessionSpec["browser"] {
  if (!agent.browserAccess || runnerRow.kind !== RUNNER_KIND.docker) return null;
  const n = browserNames(runnerRow.id);
  return { service: n.container, network: n.network };
}

/** The address the container calls back (v51, multi-machine work).
 *
 *  `LEGION_CALLBACK_URL` is a GLOBAL environment variable: it cannot be right for two machines at
 *  once. A container on the Mac mini calling back `localhost` calls the Mac mini, where there is no
 *  control plane, and the session goes silent forever. The address therefore depends on the RUNNER,
 *  whose own wins. Without `callback_url` nothing changes: the global variable, then the local
 *  port. */
export function sessionCallbackUrl(runner: { callbackUrl: string | null }): string {
  return (
    runner.callbackUrl ??
    process.env.LEGION_CALLBACK_URL ??
    `http://localhost:${process.env.PORT ?? 8790}`
  );
}

/** Eleven fields, which were eleven positional parameters until lot 11: two callers lined them up
 *  from memory, and the three consecutive `string`s could only be told apart by counting. */
export interface SpecInput {
  sessionId: string;
  callbackToken: string;
  task: TaskRow;
  agent: AgentRow;
  project: ProjectRow;
  model: string;
  mock: boolean;
  browser: SessionSpec["browser"];
  callbackUrl: string;
  resume: SessionSpec["resume"];
  /** The "how this repository titles its PRs" section (slice nav/18), already rendered by
   *  `titleExamplesPrompt`, or the empty string. It arrives READY because reading it needs the
   *  network and `buildSpec` is synchronous, and because it must be able to be empty without any
   *  caller caring. */
  titleExamples: string;
}

/** `thinkingBudget` is only passed with `enabled`: carrying it on `adaptive` or `disabled` would be
 *  a dead field in the spec, one more question when reading a trace. */
function thinkingSetting(agent: AgentRow): SessionSpec["thinking"] {
  if (agent.thinking === AGENT_THINKING.enabled)
    return {
      type: "enabled",
      ...(agent.thinkingBudget ? { budgetTokens: agent.thinkingBudget } : {}),
    };
  if (agent.thinking === AGENT_THINKING.adaptive) return { type: "adaptive" };
  if (agent.thinking === AGENT_THINKING.disabled) return { type: "disabled" };
  return null;
}

/** Only repositories GRANTED to the agent, with its access mode (v7). v29: each repository carries
 *  ITS credential, its forge's conventional user name and the NAME (never the value) of the secret
 *  to present. That replaced the `host === "github.com"` filter the runner applied to the
 *  credential store, which made every GitLab repository unclonable even read-only. */
function specRepos(task: TaskRow, agent: AgentRow, projectId: string): SessionSpec["repos"] {
  return agent.repoAccess === REPO_ACCESS.none
    ? []
    : reposOfProject(projectId)
        .filter((r) => (JSON.parse(agent.repoNames) as string[]).includes(r.name))
        .map((r) => {
          // `effectiveForge` returns `null` when the forge is neither declared nor certain from the
          // host. The repository then goes WITHOUT a credential: the container clones it if public
          // and fails plainly otherwise. The constant is gone without losing the guarantee, rather
          // than presenting a GitHub PAT to an arbitrary host.
          const forge = effectiveForge(r);
          // The declared forge is enough to decide the token (08/09). This used to also check
          // `LEGION_FORGE_HOSTS`: a repository declared "gitlab" on a self-hosted instance missing
          // from that variable left WITHOUT a credential, and the container died on "could not read
          // Username", with a warn-level event nobody reads before the failure as the only trace.
          // It happened on framagit.org on 08/09.
          //
          // Declaring a repository's forge IS the authorisation: it designates the host and names
          // the token to present. The variable now only guards the crate import, the one entry not
          // coming from the screen (crate-apply.ts).
          const credential = forge ? credentialFor(forge) : null;
          return {
            name: r.name,
            url: r.url,
            ...(forge ? { forge } : {}),
            // Read-only task (v53): the agent's right is lowered to "read" for THIS session.
            // Everything that pushes in the container (checkpoint, catch-up commit, push) is guarded
            // by `access === "write"`: that is THE lever, and it also cuts the automatic PR, which
            // requires a traced push (open-pr.ts).
            access: effectiveRepoAccess(task, agent) as "read" | "write",
            testCommand: r.testCommand,
            ...(credential
              ? {
                  credential: {
                    username: credential.username,
                    tokenEnv: credential.secretName,
                  },
                }
              : {}),
          };
        });
}

/** MCP granted = all its tools (server prefix, SDK). The inbox gate (`agent.inboxAccess`) removes
 *  the tools that talk to the human, the same family as `propose_task` and `wait_for_task`, which
 *  create an entry and put the session to sleep.
 *
 *  Opposite, `builtinTools` is the EXPOSURE list: `agentTools` unfiltered, since the gate only
 *  removes MCP names, set aside there. */
export function exposedTools(
  agent: AgentRow,
  agentTools: readonly string[],
  mcpNames: readonly string[],
): string[] {
  const allowed = agentTools.filter(
    (t) =>
      agent.inboxAccess || !(t.startsWith("mcp__legion__inbox") || INBOX_GATED_TOOLS.includes(t)),
  );
  // Plumbing goes into BOTH lists (14/09). It was only in `builtinTools`, and the two lists do not
  // do the same job: `tools` EXPOSES, `allowedTools` AUTO-ALLOWS. In `permissionMode: "dontAsk"`,
  // a tool exposed but not auto-allowed is not offered to the human, it is REFUSED with "The user
  // doesn't want to take this action right now".
  //
  // `ToolSearch`, `TaskOutput` and `Skill` were therefore visible and unusable for ALL agents.
  // Seen on interview `ZLgdmCRLgqkR`: `grilling` goes through `Skill`, `Agent` collects through
  // `TaskOutput`, and the refusals fell between two working calls, which made them look like a
  // tool failure rather than a missing right.
  //
  // Same defect, same fix, for the six core tools (15/09): `coreTools`
  // (runner-payload/mcp-tools.mts) ALWAYS registers them on the MCP server whatever `agentTools`
  // says. A custom `allowedTools` can omit one without `validateAllowedTools` objecting (it only
  // requires the two inbox tools). Without this, a session can see `fs_write` and never call it.
  return [
    ...new Set([
      ...allowed,
      ...HARNESS_TOOLS,
      ...CORE_MCP_TOOLS,
      ...mcpNames.map((n) => `mcp__${n}`),
    ]),
  ];
}

/** v40: execution comes from the project (its image, its SSH key, the `known_hosts` found next to
 *  it). Never in mock: a mock session provisions no container, and giving it a key path would
 *  hand a mount to a runner that does not exist. */
function projectRuntime(
  project: ProjectRow,
  mock: boolean,
): Pick<SessionSpec, "image" | "sshKeyPath" | "sshKnownHostsPath"> {
  if (mock) return { image: null, sshKeyPath: null, sshKnownHostsPath: null };
  return {
    image: project.sessionImage?.trim() || null,
    sshKeyPath: project.sshKeyPath?.trim() || null,
    sshKnownHostsPath: sshKnownHostsOf(project),
  };
}

export function buildSpec(input: SpecInput): SessionSpec {
  const {
    agent,
    browser,
    callbackToken,
    callbackUrl,
    mock,
    model,
    project,
    resume,
    sessionId,
    task,
    titleExamples,
  } = input;
  const agentTools = resolveAgentTools(agent);
  // Read from DISK, not the database: the run folder is the source of truth for the run's files
  // (like the task page's artifact list). One more table would say nothing more and could lie
  // about what is really there.
  const attachments = taskAttachments(task.id);
  // Branch read ONCE: `taskBranch` PINS it in the database on first call, and the commit subject
  // and the spec must talk about the same one.
  const branch = taskBranch(task);
  // Capabilities 5b: never in mock (MCP configs can contain resolved secrets).
  const mcp = mock ? { servers: {}, hosts: [], names: [] } : resolveMcpServers(agent, project.id);
  const skills = mock ? [] : packSkills(resolveSkillNames(agent, project.id));
  const network = buildNetworkPolicy(agent);
  // Rules: permanent instructions (project "all agents" + checked on the agent), even in mock (no
  // secret).
  const rulesList = resolveRules(agent, project.id);
  const notes = capabilityNotes({ project, mcpNames: mcp.names, skills, browser });
  return {
    sessionId,
    callbackUrl,
    callbackToken,
    model,
    effort: agent.effort ?? null,
    thinking: thinkingSetting(agent),
    taskId: task.id,
    taskName: task.name,
    // The final commit title when a session only made checkpoints (`chore: checkpoint (turn N)`):
    // the runner squashes them at session end (`checkpoint-squash.mts`) and must never let that
    // subject through. Computed HERE, not in the container: `conventionalTitle` lives server-side
    // (already the PR draft fallback, `review/pr-draft.ts`), and duplicating it in the payload
    // would give two definitions of the same title in two languages.
    fallbackCommitSubject: conventionalTitle(branch, task.name),
    taskDescription: buildTaskBrief({ task, agent, attachments, titleExamples }),
    agentName: agent.name,
    rolePrompt: buildRolePrompt(agent, notes),
    repos: specRepos(task, agent, project.id),
    // The run branch, except for a fix task tied to a PR: that PR's branch is reused. Shared rule
    // (lifecycle.ts): `wait_for_task` rereads it to NAME, for the woken agent, the branch where the
    // awaited task pushed its work.
    repoBranch: branch,
    gitAuthor: resolveGitAuthor(project),
    allowedTools: exposedTools(agent, agentTools, mcp.names),
    builtinTools: resolveBuiltinTools(agentTools),
    inboxEnabled: agent.inboxAccess,
    artifactsPath: artifactsPath(task),
    expectedArtifacts: JSON.parse(task.expectedArtifacts ?? "[]") as string[],
    // The operator's attachments as DATA: the brief mentions them (buildTaskBrief), the spec lists
    // them. Reread on EVERY spec build, so a file attached between two launches is seen by the
    // second, and the brief rebuilt at wake-up (resumeSession) keeps the mention, like criteria.
    attachments,
    // The slice contract as STRUCTURE: the brief already carries its text (buildTaskBrief).
    criteria: parseCriteria(task.criteria),
    // The last batch refusal, if any: a relaunched slicer without it would drop the same artifact
    // again and be refused identically.
    lotRefusal: lastLotRefusal(task.id),
    goalId: task.goalId ?? null,
    // Limited network: granted MCP hosts are added to the proxy allowlist.
    network:
      network.mode === "limited"
        ? { mode: "limited", allowedHosts: [...new Set([...network.allowedHosts, ...mcp.hosts])] }
        : network,
    browser,
    mcpServers: mcp.servers,
    skills,
    // Never in mock: a mock session has no workspace and no prompt to assemble.
    rules: mock ? [] : rulesList,
    claudeStateDir: path.join(DATA_ROOT, "sessions", sessionId, "claude"),
    // D13 / D14: see runner/workspace.ts for what each one settles, and what it does not.
    workspaceDir: workspaceDir(sessionId),
    packageCacheDir: PACKAGE_CACHE_DIR,
    ...projectRuntime(project, mock),
    resume,
    seqBase: ackOf(sessionId), // see `seqBase` in types.ts: a resume numbers on
    mock,
    // Credentials + granted secrets only for real runs (never shipped to mocks): the project's
    // account, and the memory of which one serves (see session-credential.ts).
    // BROWSER_WS_ENDPOINT is NOT a secret (a container name): set even in mock, so tests check the
    // injection without shipping a credential.
    env: {
      ...(mock
        ? {}
        : { ...sessionCredentialEnv(sessionId, project.id), ...grantedSecrets(agent, project.id) }),
      ...(browser ? { BROWSER_WS_ENDPOINT: wsEndpoint(browser.service) } : {}),
    },
  };
}

export function loadContext(taskId: string) {
  const task = taskRow(taskId);
  if (!task) throw new Error("task not found");
  if (!task.assigneeAgentId) throw new Error("task has no assigned agent");
  const agent = agentRow(task.assigneeAgentId);
  const project = projectRow(task.projectId);
  if (!agent || !project) throw new Error("agent or project not found");
  return { task, agent, project };
}

/** The repositories ACTUALLY granted to this agent. Read by two preflight checks (credentials,
 *  then network): one read, otherwise both diverge the day the filter changes. */
export function grantedReposOf(agent: AgentRow, projectId: string): RepoGrant[] {
  const granted = JSON.parse(agent.repoNames) as string[];
  return (
    reposOfProject(projectId)
      .filter((r) => granted.includes(r.name))
      // The forge travels to preflight: it decides WHICH secret is required, and the refusal
      // message names it. Without it a GitLab repository would demand GITHUB_TOKEN.
      .map((r) => ({ name: r.name, url: r.url, forge: effectiveForge(r) }))
  );
}

/** The project key as preflight must see it: its path, and the problem it poses if any. The disk
 *  is read here, once, at launch, so `preflight.ts` stays pure and `inspectSshKey` is testable
 *  without a file.
 *
 *  An unreadable key is NOT silent: it becomes a named blocker, like a missing secret. That is the
 *  point of checking it here rather than in the container, where the message is "Permission denied
 *  (publickey)" and says nothing about the cause. */
function sshKeyOf(project: ProjectRow): { path: string; problem: string | null } | null {
  const path = project.sshKeyPath?.trim();
  if (!path) return null;
  const verdict = inspectSshKey(path, (p) => {
    try {
      // A key is a few KB. Reading a hand-typed path without a ceiling would open the door to a
      // `/dev/zero` filling the control plane's memory.
      const stat = fs.statSync(p);
      if (!stat.isFile() || stat.size > 64 * 1024) return null;
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  });
  return { path, problem: verdict.ok ? null : verdict.reason };
}

/** Looked for next to the operator's key. Nothing to configure, nothing to refuse: when absent, the
 *  session runs with only the fingerprints baked into the image. */
function sshKnownHostsOf(project: ProjectRow): string | null {
  const key = project.sshKeyPath?.trim();
  if (!key) return null;
  return knownHostsBesideKey(key, (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/** Pre-container check (20/08): a start KNOWN to be unable to succeed fails here, for free, with
 *  the cause named, instead of creating a container and letting an agent spend a model turn
 *  discovering it has no code. Called at launch AND at resume. `repoBlockers` only refuses what is
 *  certain; see preflight.ts for why a read never blocks.
 *
 *  `repoAccess` is the session's EFFECTIVE right (effectiveRepoAccess), not the agent's: a
 *  read-only task needs neither forge nor push credential, and refusing it over their absence would
 *  block exactly the audit tasks v53 makes possible. */
export function assertReposReachable(
  agent: AgentRow,
  project: ProjectRow,
  repoAccess: RepoAccess,
): void {
  const projectId = project.id;
  const blockers = repoBlockers({
    agentName: agent.name,
    repoAccess,
    grantedRepos: grantedReposOf(agent, projectId),
    grantedSecretNames: JSON.parse(agent.envSecretNames) as string[],
    projectSecretNames: secretNamesOfProject(projectId),
    sshKey: sshKeyOf(project),
  });
  if (blockers.length > 0) {
    const message = blockerMessage(blockers);
    logControlEvent("warn", "preflight", `launch refused for “${agent.name}”: ${message}`, {
      agentName: agent.name,
      projectId,
      blockers,
    });
    throw new Error(message);
  }
}
