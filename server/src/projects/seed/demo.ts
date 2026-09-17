// Seed of the "Demo (mock)" project — a READ-ONLY project filled with realistic data, so the
// design and the interactions can be judged without starting an agent (no quota, no Docker).
//
//   pnpm seed:demo          → create / recreate the demo project
//   pnpm seed:demo --drop   → only delete it
//
// Idempotent: the demo project is entirely deleted and rebuilt on every run. REAL projects are
// never touched (everything is filtered on the project whose slug is "demo").
//
// THE DECOR IS LEGION BUILDING ITSELF, and that is the point: the screenshots of the README and
// of the landing page come out of this file. A made-up e-commerce backlog says nothing about what
// a control plane for coding agents does; the repository's own merged work does. Every task,
// trace and number below is taken from real merged work — file names, measured counts and the
// technical constraint that forced the shape are kept, the wording is a task title, not a quote.
import { nanoid } from "nanoid";
import Database from "better-sqlite3";
import type { schema } from "../../shared/db.js";
import { addBlocker } from "../../tasks/blockers.js";
import { formatBranch } from "../../tasks/task-branch.js";
import { SESSION_STATUS } from "../../sessions/session-terminal.js";
import { COMPLEXITY, PRIORITY } from "../../tasks/task-scales.js";
import { NETWORKING, REPO_ACCESS, RUNNER_KIND } from "../../shared/enums.js";
import { ACTIVITY_FROM } from "../../tasks/activity-enums.js";
import { createLogger } from "../../shared/log.js";
import {
  insertAgentRows,
  insertEnvironmentRows,
  insertGoalEventRows,
  insertGoalRows,
  insertInboxMessageRows,
  insertMcpServerRows,
  insertNoticeRows,
  insertProjectRow,
  insertRepoRows,
  insertRuleRows,
  insertRunnerRow,
  insertSessionEventRows,
  insertSessionRows,
  insertTaskActivityRows,
  insertTaskRows,
  insertTaskTemplateRow,
} from "./demo-store.js";

// `seed:demo` builds a decor, not a fact of the product: nothing it says should clutter the log
// the operator reads back. (Creating the demo project FROM THE SCREEN does get its
// `logControlEvent` — that is in `projects/demo.ts`, and it is a gesture, not a script.)
const log = createLogger("seed:demo");

const SLUG = "demo";
const DB_PATH = process.env.LEGION_DB ?? "legion.db";
const raw = new Database(DB_PATH);
raw.pragma("foreign_keys = ON");

const id = () => nanoid(10);
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const MIN = 60_000,
  H = 3_600_000,
  DAY = 86_400_000;

/** Deletes the demo project and ALL its dependencies (FK-safe order). */
function dropDemo(): void {
  const proj = raw.prepare("SELECT id FROM projects WHERE slug = ?").get(SLUG) as
    | { id: string }
    | undefined;
  if (!proj) return;
  const p = proj.id;
  raw.exec("BEGIN");
  try {
    raw
      .prepare(`DELETE FROM session_events WHERE session_id IN
      (SELECT s.id FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE t.project_id = ?)`)
      .run(p);
    raw
      .prepare(
        `DELETE FROM inbox_messages WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`,
      )
      .run(p);
    raw
      .prepare(
        `DELETE FROM task_activity WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`,
      )
      .run(p);
    raw
      .prepare(`DELETE FROM sessions WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`)
      .run(p);
    raw
      .prepare(
        `DELETE FROM goal_events WHERE goal_id IN (SELECT id FROM goals WHERE project_id = ?)`,
      )
      .run(p);
    raw.prepare("DELETE FROM goals WHERE project_id = ?").run(p);
    raw.prepare("DELETE FROM tasks WHERE project_id = ?").run(p);
    // FK-safe order: agents BEFORE environments (agents.environment_id references them).
    for (const t of [
      "rules",
      "mcp_servers",
      "repos",
      "task_templates",
      "secrets",
      "agents",
      "environments",
    ])
      raw.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(p);
    raw.prepare("DELETE FROM projects WHERE id = ?").run(p);
    raw.exec("COMMIT");
    log.info("previous demo project deleted");
  } catch (e) {
    raw.exec("ROLLBACK");
    throw e;
  }
}

function seedDemo(): void {
  // A runner is needed for the session foreign keys — reuse the one that already exists.
  let runnerId = (raw.prepare("SELECT id FROM runners LIMIT 1").get() as { id: string } | undefined)
    ?.id;
  if (!runnerId) {
    runnerId = id();
    insertRunnerRow({ id: runnerId, name: "local", kind: RUNNER_KIND.docker, dockerHost: null });
  }

  const projectId = id();
  insertProjectRow({
    id: projectId,
    name: "Demo (mock)",
    slug: SLUG,
    demo: true,
    defaultModel: "claude-sonnet-5",
    fsRoot: "/Users/operator/code/legion",
    context:
      "Control plane for coding agents: TypeScript / Node 20, Hono, Drizzle + SQLite, React 19 +\n" +
      "Vite, SSE for streaming (never WebSocket). Agents run in ephemeral Docker containers, one\n" +
      "per session. Decisions: Docker only, network `internal` plus an egress proxy with a domain\n" +
      "allowlist; secrets are encrypted in the database and the master key lives outside it.\n" +
      "Vocabulary: a session is one container, a run is one turn budget inside that container.",
    createdAt: ago(21 * DAY),
  });

  // ── Environments (network) ──
  const envOpen = id(),
    envLimited = id();
  insertEnvironmentRows([
    { id: envOpen, projectId, name: "open", networking: NETWORKING.open, allowedHosts: "[]" },
    {
      id: envLimited,
      projectId,
      name: "limited (Anthropic API)",
      networking: NETWORKING.limited,
      allowedHosts: JSON.stringify(["api.anthropic.com", "registry.npmjs.org"]),
    },
  ]);

  // ── Repositories ──
  // The sandbox shows a MIXED project (v29): it is the configuration hardest to picture, and
  // therefore exactly the one a demonstration screen should make visible — two forges, two
  // secrets, one board.
  const repoControl = {
    id: id(),
    projectId,
    name: "control-plane",
    url: "https://github.com/legion-oss/control-plane.git",
    forge: "github",
    testCommand: "pnpm -s test",
    createdAt: ago(20 * DAY),
  };
  const repoPayload = {
    id: id(),
    projectId,
    name: "runner-payload",
    url: "https://gitlab.com/legion-oss/runner-payload.git",
    forge: "gitlab",
    testCommand: "pnpm -s typecheck && pnpm -s test",
    createdAt: ago(20 * DAY),
  };
  insertRepoRows([repoControl, repoPayload]);

  // ── Rules (including one "suggested", raised from memory) ──
  const ruleConv = id(),
    ruleSuggested = id();
  insertRuleRows([
    {
      id: ruleConv,
      projectId,
      name: "commit-conventions",
      allAgents: true,
      status: "active",
      content: "Conventional commits (feat/fix/chore). One commit = one coherent change.",
      createdAt: ago(15 * DAY),
    },
    {
      id: id(),
      projectId,
      name: "no-any",
      allAgents: false,
      status: "active",
      content: "Never `any` in TypeScript: an explicit type, or `unknown` plus narrowing.",
      createdAt: ago(12 * DAY),
    },
    {
      id: ruleSuggested,
      projectId,
      name: "stories-next-to-modules",
      allAgents: false,
      status: "suggested",
      content:
        "Every `.tsx` module carries its `.stories.tsx` next to it. A module without one fails the gate.",
      createdAt: ago(2 * DAY),
    },
  ]);

  // ── MCP servers ──
  const mcpLinear = id();
  insertMcpServerRows([
    {
      id: mcpLinear,
      projectId,
      name: "linear",
      allowedHosts: JSON.stringify(["api.linear.app"]),
      createdAt: ago(10 * DAY),
      config: JSON.stringify({
        type: "http",
        url: "https://mcp.linear.app/mcp",
        // NO AUTHENTICATION HEADER HERE, AND IT IS THE ONLY HONEST EXAMPLE WE CAN GIVE TODAY
        // (round 1, 15/09).
        //
        // This template used to carry `authorization: "Bearer ${SECRET:LINEAR_TOKEN}"`, defended
        // by "`mcp.linear.app` authenticates over OAuth, so it is an OAuth token". That is an
        // ASSUMPTION about what the operator filed under that name — the exact shape of reasoning
        // `AUTH_FORMAT` (`connections/providers.ts`) has just declared illegitimate. And since
        // adoption (`connections/adopt-pasted.ts`) writes a personal key taken from
        // `LINEAR_API_KEY` under `LINEAR_TOKEN`, the case is REACHABLE: this template composed a
        // `Bearer` over a token that does not want one.
        //
        // THE CAUSE IS WIDER THAN THIS FILE, and it is not fixed: `${SECRET:…}`
        // (`capabilities/capabilities.ts`, `resolveSecretRefs`) substitutes a VALUE and has no
        // access to `metadata.authFormat`. Everything heading for a container or an MCP server
        // therefore recomposes its prefix at the configuration site, out of reach of
        // `authorizationHeader`. That is another piece of work; until then, a template that gets
        // copied around must not settle a question it cannot settle.
      }),
    },
    {
      id: id(),
      projectId,
      name: "playwright",
      allowedHosts: "[]",
      createdAt: ago(9 * DAY),
      config: JSON.stringify({
        type: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest", "--headless"],
      }),
    },
  ]);

  // ── Agents (least privilege made visible: varied grants) ──
  const mk = (
    name: string,
    title: string,
    extra: Partial<typeof schema.agents.$inferInsert> = {},
  ) => ({
    id: id(),
    projectId,
    name,
    title,
    rolePrompt: `You are the ${name} agent of the Legion project. ${title}.`,
    fsGrants: JSON.stringify([
      { folderPath: `/agents/${name}`, canRead: true, canWrite: true, canDelete: false },
    ]),
    createdAt: ago(20 * DAY),
    ...extra,
  });
  const aSenior = mk("senior-dev", "Implements and fixes", {
    model: null,
    repoAccess: REPO_ACCESS.write,
    repoNames: JSON.stringify(["control-plane", "runner-payload"]),
    environmentId: envOpen,
    ruleIds: JSON.stringify([]),
    mcpServerIds: JSON.stringify([mcpLinear]),
    envSecretNames: JSON.stringify(["GITHUB_TOKEN"]),
  });
  const aSpec = mk("spec", "Writes approvable specs", {
    model: "claude-opus-5",
    repoAccess: REPO_ACCESS.read,
    repoNames: JSON.stringify(["control-plane"]),
  });
  const aReview = mk("review-coordinator", "Runs the reviews, merges must-fix and should-fix", {
    repoAccess: REPO_ACCESS.read,
    repoNames: JSON.stringify(["control-plane", "runner-payload"]),
    environmentId: envLimited,
  });
  const aWriter = mk("writer", "Isolated writer — limited network", {
    environmentId: envLimited,
    inboxAccess: false,
  });
  insertAgentRows([aSenior, aSpec, aReview, aWriter]);

  // ── Chain template ──
  insertTaskTemplateRow({
    id: id(),
    projectId,
    name: "Full feature",
    description: "spec → implementation → review",
    autoRunNext: true,
    createdAt: ago(8 * DAY),
    steps: JSON.stringify([
      {
        name: "Specify",
        agentName: "spec",
        prompt: "Write the approvable spec.",
        approvalGate: true,
        expectedArtifacts: ["spec.md"],
      },
      {
        name: "Implement",
        agentName: "senior-dev",
        prompt: "Implement the approved spec.",
        approvalGate: false,
        expectedArtifacts: ["pr.md"],
      },
      {
        name: "Review",
        agentName: "review-coordinator",
        prompt: "Consolidate the review.",
        approvalGate: true,
        expectedArtifacts: ["review.md"],
      },
    ]),
  });

  // ── Tasks: cover EVERY state of the board ──
  type TaskIn = typeof schema.tasks.$inferInsert;
  // Rank (v21): a call counter rather than `createdAt` — most demo tasks share the same default
  // `createdAt` below, which would pin every column to the same rank. The call order of `task()`
  // (= the reading order of this file) is a stable rank, as a first real drag and drop on a
  // freshly filled board would be.
  let boardOrderSeq = 0;
  const task = (o: Partial<TaskIn> & Pick<TaskIn, "name" | "status">): TaskIn => {
    const row: TaskIn = {
      id: id(),
      projectId,
      description: "",
      assigneeAgentId: aSenior.id,
      createdAt: ago(3 * DAY),
      updatedAt: ago(2 * H),
      boardOrder: boardOrderSeq++ * 1000,
      ...o,
    };
    // The branch is SET here, with the real function: a demo task is frozen in time, it will
    // never "start", so `taskBranch` would never fix it and the screen would say "named on first
    // run" on a task that looks finished.
    return {
      ...row,
      branch: formatBranch(row.type ?? "chore", row.name, row.templateRunId ?? row.id),
    };
  };

  // "Later" carries the two pieces of work that were deliberately deferred by a merged change and
  // named in its body. An empty first lane reads as an unfinished product on a screenshot, and it
  // would also be a lie: every project has a shelf.
  const tLaterSecrets = task({
    name: "Let `${SECRET:…}` carry the auth format instead of rebuilding the prefix",
    status: "later",
    priority: PRIORITY.med,
    complexity: COMPLEXITY.high,
    type: "chore",
    description:
      "`resolveSecretRefs` substitutes a value and never sees `metadata.authFormat`, so every call site recomposes its own `Bearer`. Deferred while the MCP template was made to state the gap instead of guessing.",
  });
  const tLaterBundle = task({
    name: "Split the web bundle: one chunk is over 500 kB",
    status: "later",
    priority: PRIORITY.low,
    complexity: COMPLEXITY.med,
    assigneeAgentId: aSpec.id,
    description: "The build warning has been there since June and no measurement backs a fix yet.",
  });

  const tTodoHigh = task({
    name: "Docker down or disk full: take the task out of the queue loop",
    status: "todo",
    priority: PRIORITY.high,
    complexity: COMPLEXITY.high,
    type: "bugfix",
    description:
      "`assertRunnerReady` rejects, the queue puts the task back, `pumpQueue` picks the same machine 30 seconds later. One failed session and two log lines every 30 seconds, per task, for as long as the outage lasts.",
  });
  const tTodoQueued = task({
    name: "Propose a rebuild when a runner does not carry the image",
    status: "todo",
    priority: PRIORITY.high,
    complexity: COMPLEXITY.high,
    type: "feature",
    queued: true,
    description:
      "The gesture that repairs it is one click away on the Runners card. The failure happens from the queue, with nobody in front of the screen: it has to reach the inbox.",
  });
  const tTodoLow = task({
    name: "Document how to read a harness failure",
    status: "todo",
    priority: PRIORITY.low,
    complexity: COMPLEXITY.low,
    assigneeAgentId: aWriter.id,
    description: "Declare a debt, pay a debt, and why a baseline fails in both directions.",
  });

  // nav/11 slice: the demo must show the TWO pauses side by side, otherwise nothing proves to the
  // eye that we tell them apart. This one is stopped on a QUESTION — the agent is missing a fact
  // it cannot find in the repository.
  const tDoingGate = task({
    name: "Prefer a machine that already carries the session image",
    status: "doing",
    priority: PRIORITY.high,
    complexity: COMPLEXITY.high,
    type: "feature",
    approvalGate: true,
    description:
      "`pickRunnerRow` weighs reachability, capacity and disk, never the image. A machine without it is named as readily as any other, and preflight refuses right after — even when another machine in the fleet has it.",
  });
  // The second pause: stopped on a DECISION, not on a question. Same pause as above, same
  // destroyed container, same `sdkSessionId` kept — what differs is what is being waited for, and
  // that is what the badge has to make readable without reading. It is declared RIGHT AFTER its
  // twin so the two land as neighbours in the lane: the open questions push the lanes down, and
  // "side by side" is only true if both badges fit above the fold at 1440x900.
  const tDoingBlocked = task({
    name: "Remove the orphan session containers from the home server",
    status: "doing",
    priority: PRIORITY.med,
    complexity: COMPLEXITY.med,
    description:
      "The 01→02/09 incident left 214 containers and around 9,000 orphan processes. `docker rm -f` cannot be undone.",
  });
  const tDoing2 = task({
    name: "Judge inertia continuously, raise the turn ceiling",
    status: "doing",
    priority: PRIORITY.med,
    complexity: COMPLEXITY.high,
    type: "bugfix",
    description:
      "The turn budget triggers a measurement that has nothing to do with it. `onTurnEnd` must read the inertia verdict at every turn, and then 200 turns are no longer a ceiling worth keeping.",
  });

  const tReviewGate = task({
    // A deliberately long title (16/09, compact overflow task): without it, rule A of
    // `measure-compact.mjs` would pass on the channel selector for lack of data to catch.
    name: "Inertia pause and automatic relaunch of long runs when a session stops committing for several turns",
    status: "review",
    priority: PRIORITY.high,
    complexity: COMPLEXITY.high,
    type: "feature",
    approvalGate: true,
    assigneeAgentId: aSenior.id,
    description:
      "A session that runs out of turns is paused rather than killed: the container goes, the `sdkSessionId` stays, a new run picks the conversation back up. Both repositories are touched; the change requests wait for a human.",
    prUrls: JSON.stringify([
      { repo: "control-plane", url: "https://github.com/legion-oss/control-plane/pull/151" },
      {
        repo: "runner-payload",
        url: "https://gitlab.com/legion-oss/runner-payload/-/merge_requests/44",
      },
    ]),
    externalRef: JSON.stringify({
      provider: "linear",
      issueId: "iss_demo_1",
      identifier: "LGN-214",
      url: "https://linear.app/legion-oss/issue/LGN-214",
    }),
  });
  const tReview = task({
    name: "Spec: what the queue does while an image is rebuilding",
    status: "review",
    priority: PRIORITY.med,
    complexity: COMPLEXITY.med,
    assigneeAgentId: aSpec.id,
    description: "Four rounds of interview, every decision settled by the operator.",
  });
  const tDone = task({
    name: "Name the artifacts folder in the system prompt",
    status: "done",
    priority: PRIORITY.high,
    complexity: COMPLEXITY.med,
    type: "bugfix",
    updatedAt: ago(6 * H),
    description:
      "12 refusals over 12 distinct sessions and 5 agents: the prompt said “the artifacts folder of this task” without naming it, so the agent listed `/artifacts`, which no grant covers.",
    prUrls: JSON.stringify([
      { repo: "control-plane", url: "https://github.com/legion-oss/control-plane/pull/137" },
    ]),
  });
  const tDoneArchived = task({
    name: "Drop the label from the click-to-send hint",
    status: "done",
    priority: PRIORITY.low,
    complexity: COMPLEXITY.low,
    archived: true,
    updatedAt: ago(5 * DAY),
  });
  const tFailed = task({
    name: "Replace the Chrome story sweep with a jsdom gate",
    status: "review",
    priority: PRIORITY.med,
    complexity: COMPLEXITY.med,
    description:
      "The sweep opens all 894 stories in a real Chrome: six minutes, the heaviest item of `make gates`, and false positives under contention.",
  });

  // Chain (template run): step 1 in review in front of its gate, step 2 blocked by it. Step 1 is
  // NOT `done`: a blocker turning done consumes its link (behaviour 8), so "blocked by a finished
  // step" is a state the runtime never produces — the demo must not show a board nobody will see
  // (proof of slice 02, #15).
  const runId = id();
  const tStep1 = task({
    name: "Specify · Navigation overhaul",
    status: "review",
    assigneeAgentId: aSpec.id,
    stepIndex: 0,
    templateRunId: runId,
    approvalGate: true,
    expectedArtifacts: JSON.stringify(["spec.md"]),
    updatedAt: ago(20 * H),
  });
  const tStep2 = task({
    name: "Implement · Navigation overhaul",
    status: "todo",
    assigneeAgentId: aSenior.id,
    stepIndex: 1,
    templateRunId: runId,
    expectedArtifacts: JSON.stringify(["pr.md"]),
    priority: PRIORITY.med,
  });

  const allTasks = [
    tLaterSecrets,
    tLaterBundle,
    tTodoHigh,
    tTodoQueued,
    tTodoLow,
    tDoingGate,
    tDoingBlocked,
    tDoing2,
    tReviewGate,
    tReview,
    tDone,
    tDoneArchived,
    tFailed,
    tStep1,
    tStep2,
  ];
  insertTaskRows(allTasks);
  addBlocker(tStep2.id, tStep1.id); // after insertion: the link points at two rows that must exist (FK)

  // ── Sessions: every status, with credible costs and durations ──
  type SessionIn = typeof schema.sessions.$inferInsert;
  const sess = (o: Partial<SessionIn> & Pick<SessionIn, "taskId" | "status">): SessionIn => ({
    id: id(),
    agentId: aSenior.id,
    runnerId: runnerId!,
    model: "claude-sonnet-5",
    callbackToken: nanoid(24),
    mock: true,
    startedAt: ago(2 * H),
    eventCount: 42,
    ...o,
  });
  const sWaiting = sess({
    taskId: tDoingGate.id,
    status: SESSION_STATUS.waiting,
    startedAt: ago(35 * MIN),
    costUsd: 0.42,
    eventCount: 61,
    sdkSessionId: nanoid(20),
  });
  const sBlocked = sess({
    taskId: tDoingBlocked.id,
    status: "blocked",
    startedAt: ago(52 * MIN),
    costUsd: 0.18,
    eventCount: 34,
    sdkSessionId: nanoid(20),
  });
  // THE REFERENCE CHANNEL FOR MEASUREMENT: running, a thread with both speakers, and a trace long
  // enough for the channel column to scroll at 375x812. Started earlier than the others (46 min)
  // to carry all that work.
  const sRunning = sess({
    taskId: tDoing2.id,
    status: "running",
    startedAt: ago(46 * MIN),
    costUsd: 0.34,
    eventCount: 47,
    sdkSessionId: nanoid(20),
  });
  const sCommitting = sess({
    taskId: tReview.id,
    status: "committing",
    agentId: aSpec.id,
    model: "claude-opus-5",
    startedAt: ago(18 * MIN),
    costUsd: 0.96,
    eventCount: 88,
  });
  const sDoneA = sess({
    taskId: tDone.id,
    status: "destroyed",
    startedAt: ago(9 * H),
    endedAt: ago(8 * H),
    costUsd: 1.24,
    eventCount: 154,
  });
  const sDoneB = sess({
    taskId: tReviewGate.id,
    status: "destroyed",
    startedAt: ago(30 * H),
    endedAt: ago(28 * H),
    costUsd: 2.87,
    eventCount: 240,
  });
  const sDoneSpec = sess({
    taskId: tStep1.id,
    status: "destroyed",
    agentId: aSpec.id,
    model: "claude-opus-5",
    startedAt: ago(23 * H),
    endedAt: ago(22 * H),
    costUsd: 0.78,
    eventCount: 96,
  });
  const sFailed = sess({
    taskId: tFailed.id,
    status: "failed",
    startedAt: ago(4 * H),
    endedAt: ago(3 * H),
    costUsd: 0.35,
    eventCount: 40,
  });
  const sCheap = sess({
    taskId: tDoneArchived.id,
    status: "destroyed",
    agentId: aWriter.id,
    model: "claude-haiku-4-5",
    startedAt: ago(5 * DAY),
    endedAt: ago(5 * DAY - 20 * MIN),
    costUsd: 0.04,
    eventCount: 18,
  });
  const sessions = [
    sWaiting,
    sBlocked,
    sRunning,
    sCommitting,
    sDoneA,
    sDoneB,
    sDoneSpec,
    sFailed,
    sCheap,
  ];
  insertSessionRows(sessions);

  // Inbox ids shared between the `inbox_ask` event (the thread, transcript.ts) and the row
  // inserted further down in `inbox_messages` (the action band): it is the SAME round, it must
  // carry the SAME id. Without that, `transcript.ts` invents a fallback id (`q<index>`) that never
  // matches the band's, and the open question renders TWICE — once folded into the band, once as a
  // full panel in the thread, for want of knowing they are one (see `promotedInboxId` in
  // channel-stream.tsx).
  const inboxImage = id();
  const inboxPrune = id();
  const inboxQueue = id();

  // ── Session events (a timeline that reads on the task page) ──
  const ev = (sessionId: string, type: string, payload: unknown, minsAgo: number) => ({
    sessionId,
    type,
    payload: JSON.stringify(payload),
    createdAt: ago(minsAgo * MIN),
  });
  // The event vocabulary follows THE PRODUCTION ONE (see line() in TaskPage): init, status,
  // tool_start/tool_end, text, result, repo_ready/repo_push, inbox_ask/inbox_answer, fs_op,
  // capabilities, throttle, run_error, task_status. Otherwise the demo would be validating a
  // rendering that does not exist.
  // Varied durations, deterministic — no Math.random, so a replayed seed gives the same screen.
  const tool = (s: string, name: string, input: string, m: number) => [
    ev(s, "tool_start", { tool: name, input }, m),
    ev(
      s,
      "tool_end",
      { durationMs: 180 + ((name.length * 631 + input.length * 97 + Math.round(m * 13)) % 5200) },
      m - 0.2,
    ),
  ];
  insertSessionEventRows(
    [
      // ── Image-aware runner pick (session waiting on a human answer) ──
      ev(
        sWaiting.id,
        "status",
        { status: "starting", runner: "local", network: "open", model: "claude-sonnet-5" },
        35,
      ),
      ev(sWaiting.id, "init", { model: "claude-sonnet-5", apiKeySource: "none" }, 34.8),
      ev(sWaiting.id, "capabilities", { skills: ["lean-ctx"], mcpServers: ["linear"] }, 34.6),
      ev(
        sWaiting.id,
        "repo_ready",
        { repo: "control-plane", dir: "./repos/control-plane", branch: "legion/runner-image-pick" },
        34.4,
      ),
      ev(
        sWaiting.id,
        "text",
        { text: "Reading pickRunnerRow and the disk filter it already carries." },
        34,
      ),
      ...tool(sWaiting.id, "Read", "/repos/control-plane/src/sessions/runner/chosen-runner.ts", 33),
      ...tool(sWaiting.id, "Grep", "assertImagePresent", 31),
      // A file path as bare text, no backticks (16/09, compact overflow task): what an agent
      // writes in a channel message; without `overflow-wrap` on `.ui-prose` it overflowed (45px at 375px).
      ev(
        sWaiting.id,
        "text",
        {
          text: "The existing check is repos/control-plane/src/sessions/runner/image-preflight-candidate-selection-default-policy.ts, I start from it rather than writing a new one.",
        },
        29,
      ),
      ev(
        sWaiting.id,
        "text",
        {
          text: "Two ways to keep a machine without the image out of the pick, and they do not cost the same. I ask before writing.",
        },
        28,
      ),
      ev(
        sWaiting.id,
        "inbox_ask",
        {
          inboxId: inboxImage,
          body: "Probe `docker image inspect` on every candidate at pick time, or remember the last known verdict per (runner, image)?",
        },
        27,
      ),
      ev(sWaiting.id, "status", { status: SESSION_STATUS.waiting }, 26.8),

      // ── Orphan containers (session stopped on an approval decision) ──
      ev(
        sBlocked.id,
        "status",
        { status: "starting", runner: "local", network: "open", model: "claude-sonnet-5" },
        52,
      ),
      ev(sBlocked.id, "init", { model: "claude-sonnet-5", apiKeySource: "none" }, 51.8),
      ev(
        sBlocked.id,
        "repo_ready",
        { repo: "control-plane", dir: "./repos/control-plane", branch: "legion/prune-orphans" },
        51.4,
      ),
      ...tool(
        sBlocked.id,
        "Bash",
        "docker ps -a --filter label=legion.session --format '{{.ID}}' | wc -l",
        50,
      ),
      ev(
        sBlocked.id,
        "text",
        {
          text: "214 containers left by the 01→02/09 incident, around 9,000 orphan processes, 38 GB to reclaim. `docker rm -f` cannot be undone: I ask before running it.",
        },
        46,
      ),
      ev(
        sBlocked.id,
        "inbox_ask",
        {
          inboxId: inboxPrune,
          body: "May I remove the 214 orphan session containers (38 GB) from the home server?",
        },
        45,
      ),
      ev(sBlocked.id, "status", { status: "blocked" }, 44.8),

      // ── Inertia (running session) ── THE REFERENCE CHANNEL: a thread with both speakers (agent
      // AND operator, through a `steer`) and a trace long enough for the channel column to scroll
      // at 375x812 — without it no session runs outside production for that measurement to exist.
      ev(
        sRunning.id,
        "status",
        { status: "running", runner: "local", model: "claude-sonnet-5" },
        46,
      ),
      ev(sRunning.id, "init", { model: "claude-sonnet-5", apiKeySource: "none" }, 45.8),
      ev(sRunning.id, "capabilities", { skills: ["lean-ctx"], mcpServers: ["linear"] }, 45.6),
      ev(
        sRunning.id,
        "repo_ready",
        { repo: "runner-payload", dir: "./repos/runner-payload", branch: "legion/inertia" },
        45.4,
      ),
      ev(
        sRunning.id,
        "text",
        { text: "Reading how the turn budget ends up triggering the inertia check." },
        45,
      ),
      ...tool(sRunning.id, "Read", "/repos/runner-payload/src/session-runner.mts", 44),
      ...tool(sRunning.id, "Grep", "INERTIA_STALE_TURNS", 43),
      ...tool(sRunning.id, "Read", "/repos/runner-payload/src/turn-budget.mts", 42),
      ...tool(sRunning.id, "Grep", "maxTurns", 41),
      ...tool(sRunning.id, "Glob", "src/**/*.test.mts", 40),
      ...tool(sRunning.id, "Read", "/repos/runner-payload/src/sdk-options.mts", 39),
      ...tool(sRunning.id, "Read", "/repos/control-plane/src/sessions/turn-relaunch.ts", 38),
      ev(
        sRunning.id,
        "text",
        {
          text: "Inertia is only read at the budget pause turn. I move it to onTurnEnd, then 200 turns stop being a ceiling worth keeping: 400, pause at 375, warning at 300.",
        },
        36,
      ),
      ...tool(sRunning.id, "Edit", "/repos/runner-payload/src/session-runner.mts", 34),
      ...tool(sRunning.id, "Edit", "/repos/runner-payload/src/turn-budget.mts", 31),
      ...tool(sRunning.id, "Edit", "/repos/runner-payload/src/sdk-options.mts", 29),
      ...tool(sRunning.id, "Bash", "pnpm -s typecheck", 26),
      ...tool(sRunning.id, "Edit", "/repos/control-plane/src/sessions/turn-relaunch.ts", 23),
      ev(
        sRunning.id,
        "text",
        {
          text: "The comment there claimed a higher maxTurns would swell the conversation. It is false: `resume` reloads the same conversation as is, and the SDK bounds its own window.",
        },
        20,
      ),
      ...tool(sRunning.id, "Bash", "pnpm -s test runner-payload", 17),
      ev(
        sRunning.id,
        "text",
        {
          text: "One test falls: a session already flagged inert asks twice in the same episode. I bound the nudge with inertiaNudgedSinceTurn.",
        },
        15,
      ),
      ...tool(sRunning.id, "Edit", "/repos/runner-payload/src/session-runner.mts", 12),
      ...tool(sRunning.id, "Bash", "pnpm -s test runner-payload", 10),
      // The `steer` is the SECOND speaker of the thread, beyond the pinned brief: a message sent
      // WHILE the session runs, rendered `who: "human"` by transcript.ts.
      ev(
        sRunning.id,
        "steer",
        {
          text: "While you are in there: repos.mts cuts the path out of `git status --porcelain` with a fixed .slice(3). The separator can be wider than one space.",
        },
        8,
      ),
      ev(sRunning.id, "steer_delivered", { steerId: "st_1" }, 7.9),
      ev(
        sRunning.id,
        "text",
        {
          text: "Right — three characters is an assumption. I replace it with porcelainPath(), a regex that eats the two status characters git guarantees and then the run of spaces.",
        },
        7,
      ),
      ...tool(sRunning.id, "Edit", "/repos/runner-payload/src/repos.mts", 5),
      ...tool(sRunning.id, "Edit", "/repos/runner-payload/src/repos.test.mts", 3),
      ...tool(sRunning.id, "Bash", "pnpm -s test runner-payload", 1.5),
      ev(
        sRunning.id,
        "text",
        { text: "Green, 711 tests. Writing the turn-budget note before I push." },
        0.5,
      ),

      // ── Story sweep (failed session → diagnosis) ──
      ev(sFailed.id, "status", { status: "running", runner: "local" }, 240),
      ...tool(sFailed.id, "Bash", "node web/scripts/ds-smoke.mjs --all", 215),
      ev(
        sFailed.id,
        "run_error",
        { message: "Timeout after 600s — Chrome killed at story 512 of 894 under contention" },
        190,
      ),
      ev(sFailed.id, "status", { status: "failed" }, 189),

      // ── Artifacts path (finished, change request opened) ──
      ev(sDoneA.id, "status", { status: "running", runner: "local" }, 520),
      ev(
        sDoneA.id,
        "text",
        {
          text: "12 refusals over 12 distinct sessions and 5 agents: the agent lists /artifacts to find its scope, and no grant covers that folder. The spec has carried artifactsPath all along.",
        },
        500,
      ),
      ...tool(sDoneA.id, "Edit", "/repos/control-plane/src/sessions/prompt.ts", 496),
      ...tool(sDoneA.id, "Bash", "pnpm -s test sessions", 494),
      ...tool(sDoneA.id, "Write", "/repos/control-plane/pr.md", 490),
      ev(sDoneA.id, "repo_push", { repo: "control-plane", changes: 4, commit: "a1c93f2" }, 486),
      ev(sDoneA.id, "result", { subtype: "success", costUsd: 1.24 }, 483),
      ev(sDoneA.id, "task_status", { status: "review" }, 482),
      ev(sDoneA.id, "status", { status: "destroyed" }, 480),

      // ── Inertia pause and relaunch (2 change requests, gate waiting) ──
      ev(
        sDoneB.id,
        "status",
        { status: "running", runner: "local", network: "open", model: "claude-sonnet-5" },
        1800,
      ),
      ev(
        sDoneB.id,
        "repo_ready",
        { repo: "control-plane", dir: "./repos/control-plane", branch: "legion/inertia-pause" },
        1798,
      ),
      ev(
        sDoneB.id,
        "repo_ready",
        { repo: "runner-payload", dir: "./repos/runner-payload", branch: "legion/inertia-pause" },
        1797,
      ),
      ev(
        sDoneB.id,
        "text",
        {
          text: "A session out of turns is destroyed and lost. I pause it instead: container gone, sdkSessionId kept, a new run resumes the conversation.",
        },
        1790,
      ),
      ...tool(sDoneB.id, "Read", "/repos/runner-payload/src/pause-guards.mts", 1780),
      ...tool(sDoneB.id, "Edit", "/repos/runner-payload/src/pause-guards.mts", 1760),
      ...tool(sDoneB.id, "Edit", "/repos/control-plane/src/sessions/turn-relaunch.ts", 1740),
      ...tool(sDoneB.id, "Bash", "pnpm -s test", 1720),
      ev(sDoneB.id, "text", { text: "Green: 711 tests. Writing pr.md for both repos." }, 1700),
      ...tool(sDoneB.id, "Write", "/repos/control-plane/pr.md", 1690),
      ev(sDoneB.id, "repo_push", { repo: "control-plane", changes: 7, commit: "5f0be31" }, 1688),
      ev(sDoneB.id, "repo_push", { repo: "runner-payload", changes: 3, commit: "9d4ac07" }, 1687),
      // `rateLimitType` follows the SDK VOCABULARY (`five_hour` / `seven_day`, see
      // SDKRateLimitInfo). The demo used to say "5h" / "7d": invented names, so the gauge drew two
      // lines for the same window as soon as a real event arrived.
      ev(
        sDoneB.id,
        "throttle",
        {
          kind: "rate_limit",
          status: "allowed_warning",
          rateLimitType: "five_hour",
          utilization: 0.72,
          resetsAt: Math.floor((now + 2 * H) / 1000),
        },
        1686,
      ),
      // A subscription has TWO limit windows: the rail gauge must be able to show both.
      ev(
        sDoneB.id,
        "throttle",
        {
          kind: "rate_limit",
          status: "allowed",
          rateLimitType: "seven_day",
          utilization: 0.41,
          resetsAt: Math.floor((now + 4 * 24 * H) / 1000),
        },
        1685,
      ),
      ev(sDoneB.id, "result", { subtype: "success", costUsd: 2.87 }, 1685.5),
      ev(sDoneB.id, "status", { status: "committing" }, 1685),
      ev(sDoneB.id, "status", { status: "destroyed" }, 1680),

      // ── Queue-during-rebuild spec (session committing) ──
      ev(
        sCommitting.id,
        "status",
        { status: "running", runner: "local", model: "claude-opus-5" },
        18,
      ),
      ev(
        sCommitting.id,
        "text",
        {
          text: "Writing the spec: what the queue does between the refusal and the rebuilt image.",
        },
        16,
      ),
      ev(
        sCommitting.id,
        "inbox_ask",
        {
          inboxId: inboxQueue,
          body: "A rebuild takes about two minutes. Does the queue keep skipping the task until the image lands, or hold it?",
        },
        12,
      ),
      ev(sCommitting.id, "fs_op", { op: "write", path: "/agents/spec/spec.md" }, 9),
      ...tool(sCommitting.id, "Write", "/agents/spec/spec.md", 8),

      // ── Chain step 1 (navigation spec) ──
      ev(sDoneSpec.id, "status", { status: "running" }, 1380),
      ev(
        sDoneSpec.id,
        "text",
        {
          text: "Navigation spec: canonical addresses, the content of each row, and a gate that keeps links off the redirects.",
        },
        1370,
      ),
      ...tool(sDoneSpec.id, "Write", "/agents/spec/spec.md", 1360),
      ev(sDoneSpec.id, "result", { subtype: "success", costUsd: 0.78 }, 1355),
      ev(sDoneSpec.id, "status", { status: "destroyed" }, 1350),

      // ── Click-to-send hint (archived, writer agent on a limited network) ──
      ev(
        sCheap.id,
        "status",
        { status: "running", network: "limited", model: "claude-haiku-4-5" },
        7210,
      ),
      ev(
        sCheap.id,
        "fs_denied",
        {
          op: "write",
          path: "/repos/control-plane/package.json",
          reason: "outside the granted folders",
        },
        7205,
      ),
      ev(
        sCheap.id,
        "text",
        {
          text: "Label removed from the click-to-send hint; the shortcut still shows on the eight buttons that carry it.",
        },
        7200,
      ),
      ev(sCheap.id, "result", { subtype: "success", costUsd: 0.04 }, 7195),
    ].flat(),
  );

  // ── Inbox: two open questions, and two already answered ──
  // TWO open questions and no more (16/09): the open ones stack at the top of the board, and three
  // of them pushed the columns below the fold on a 1440x900 screenshot. The two that stay are the
  // pair that must be told apart — a missing fact, and the right to do something irreversible.
  // The open ones reuse the id set above (`inboxImage` / `inboxPrune`), shared with the
  // `inbox_ask` event of the thread — same round, same id.
  insertInboxMessageRows([
    {
      id: inboxImage,
      sessionId: sWaiting.id,
      taskId: tDoingGate.id,
      agentId: aSenior.id,
      kind: "choice",
      status: "open",
      // Short on purpose: the open questions stack above the lanes, and each line they take is a
      // line of board the 1440x900 screenshot loses. The trade-off itself belongs in the thread.
      body: "Probe the image on every candidate at pick time, or remember the last verdict per (runner, image)?",
      choices: JSON.stringify([
        { id: "c1", label: "Probe at pick time" },
        { id: "c2", label: "Remember the last verdict" },
      ]),
      createdAt: ago(27 * MIN),
    },
    // The APPROVAL request: `evidence` and `impact` are filled in, because this is exactly the
    // case where the operator has to be able to decide without opening the session.
    {
      id: inboxPrune,
      sessionId: sBlocked.id,
      taskId: tDoingBlocked.id,
      agentId: aSenior.id,
      kind: "choice",
      status: "open",
      body: "May I remove the 214 orphan session containers (38 GB) from the home server?",
      evidence:
        "docker ps -a --filter label=legion.session | wc -l → 214 containers, ~9,000 orphan processes, 38.2 GB reclaimable",
      impact:
        "Irreversible: the container filesystems go with them. Session traces live in the database and are not touched.",
      choices: JSON.stringify([
        { id: "c1", label: "Remove them" },
        { id: "c2", label: "Leave them alone" },
      ]),
      createdAt: ago(45 * MIN),
    },
    {
      id: inboxQueue,
      sessionId: sCommitting.id,
      taskId: tReview.id,
      agentId: aSpec.id,
      kind: "text",
      status: "answered",
      body: "A rebuild takes about two minutes. Does the queue keep skipping the task until the image lands, or hold it?",
      answerText:
        "It keeps skipping. The queue already pumps every 30 seconds; the moment the image is there the run goes through, and nobody has to come back.",
      createdAt: ago(12 * MIN),
      answeredAt: ago(10 * MIN),
    },
    {
      id: id(),
      sessionId: sDoneA.id,
      taskId: tDone.id,
      agentId: aSenior.id,
      kind: "choice",
      status: "answered",
      body: "The scope cannot be guessed. Do I name the artifacts path in the prompt, or widen the grant to `/artifacts`?",
      choices: JSON.stringify([
        { id: "c1", label: "Name the path in the prompt" },
        { id: "c2", label: "Widen the grant" },
      ]),
      selectedChoiceId: "c1",
      answerText: "Name the path in the prompt",
      createdAt: ago(9 * H),
      answeredAt: ago(8.5 * H),
    },
  ]);

  // ── Task activity (human / agent thread) ──
  insertTaskActivityRows([
    {
      id: id(),
      taskId: tReviewGate.id,
      from: ACTIVITY_FROM.agent,
      body: "Change requests open on control-plane and runner-payload, suite green (711 tests).",
      createdAt: ago(28 * H),
    },
    {
      id: id(),
      taskId: tReviewGate.id,
      from: ACTIVITY_FROM.human,
      body: "Check that a relaunched run really gets a clean container and not the paused one.",
      createdAt: ago(26 * H),
    },
    {
      id: id(),
      taskId: tDone.id,
      from: ACTIVITY_FROM.system,
      body: "Task moved to done — CHANGELOG updated.",
      createdAt: ago(6 * H),
    },
  ]);

  // ── Goals: draft, active, completed, stopped ──
  type GoalIn = typeof schema.goals.$inferInsert;
  const goal = (o: Partial<GoalIn> & Pick<GoalIn, "name" | "request" | "status">): GoalIn => ({
    id: id(),
    projectId,
    mock: true,
    allowedAgentIds: JSON.stringify([aSenior.id, aSpec.id, aReview.id]),
    createdAt: ago(2 * DAY),
    ...o,
  });
  const gActive = goal({
    name: "A long run never dies in silence",
    request: "A session that runs for hours finishes, asks, or hands over — it never disappears.",
    status: "active",
    dodApproved: true,
    iterations: 4,
    spentUsd: 6.42,
    budgetUsd: 25,
    startedAt: ago(30 * H),
    dod: JSON.stringify([
      { id: "d1", text: "A run out of turns pauses instead of failing", done: true },
      {
        id: "d2",
        text: "A relaunch keeps the sdkSessionId and gets a clean container",
        done: true,
      },
      {
        id: "d3",
        text: "Inertia is judged at every turn end, not at the budget pause",
        done: false,
      },
      { id: "d4", text: "No regression on the turn budget suite", done: false },
    ]),
    plan: JSON.stringify([
      {
        step: "Read how a long run dies today",
        agentName: "spec",
        why: "map it before touching it",
      },
      {
        step: "Pause instead of failing",
        agentName: "senior-dev",
        why: "the container is the only thing worth losing",
      },
      {
        step: "Judge inertia at every turn",
        agentName: "senior-dev",
        why: "the turn budget was the wrong trigger",
      },
      {
        step: "Consolidated review",
        agentName: "review-coordinator",
        why: "human gate before merge",
      },
    ]),
  });
  const gCompleted = goal({
    name: "The story gate runs in CI",
    request: "Proving that 894 stories render must cost seconds, and must run on every push.",
    status: "completed",
    dodApproved: true,
    iterations: 6,
    spentUsd: 4.18,
    budgetUsd: 20,
    startedAt: ago(8 * DAY),
    endedAt: ago(7 * DAY),
    createdAt: ago(8 * DAY),
    dod: JSON.stringify([
      { id: "d1", text: "The gate runs under 10 s instead of six minutes", done: true },
      { id: "d2", text: "It runs in CI, not only on a machine with a Chrome", done: true },
    ]),
    plan: JSON.stringify([
      {
        step: "Measure what the sweep actually asserts",
        agentName: "senior-dev",
        why: "find what is worth keeping",
      },
    ]),
  });
  const gStopped = goal({
    name: "Move the fleet to rootless Docker",
    request: "Every runner runs sessions without a privileged daemon.",
    status: "stopped-stuck",
    dodApproved: true,
    iterations: 3,
    noProgressStreak: 3,
    spentUsd: 2.05,
    startedAt: ago(4 * DAY),
    endedAt: ago(3 * DAY),
    createdAt: ago(4 * DAY),
    dod: JSON.stringify([
      { id: "d1", text: "A rootless daemon answers on the home server", done: true },
      { id: "d2", text: "A session runs with no privileged mount", done: false },
    ]),
    plan: JSON.stringify([
      {
        step: "Stand up a rootless daemon",
        agentName: "senior-dev",
        why: "prerequisite to the switch",
      },
    ]),
  });
  const gDraft = goal({
    name: "Navigation overhaul",
    request:
      "Every link points at the address it means, and each settings row answers one question.",
    status: "draft",
    dodApproved: false,
    createdAt: ago(3 * H),
    dod: JSON.stringify([
      { id: "d1", text: "No link points at an address that redirects", done: false },
      { id: "d2", text: "A gate keeps it that way", done: false },
    ]),
    plan: JSON.stringify([
      { step: "Audit every link of the rail", agentName: "spec", why: "scope it before coding" },
    ]),
  });
  insertGoalRows([gActive, gCompleted, gStopped, gDraft]);

  // Attach two tasks to the active goal (the "tasks of the goal" view)
  raw
    .prepare("UPDATE tasks SET goal_id = ? WHERE id IN (?, ?)")
    .run(gActive.id, tReviewGate.id, tDoing2.id);

  // ── Goal events (timeline of the Goal page) ──
  insertGoalEventRows([
    {
      goalId: gActive.id,
      type: "status",
      payload: JSON.stringify({ status: "active", dodApproved: true }),
      createdAt: ago(30 * H),
    },
    {
      goalId: gActive.id,
      type: "decision",
      payload: JSON.stringify({
        agentName: "spec",
        why: "Map how a long run dies before changing it",
        task: "Audit of the turn budget",
      }),
      createdAt: ago(29 * H),
    },
    {
      goalId: gActive.id,
      type: "task_done",
      payload: JSON.stringify({ task: "Audit of the turn budget", costUsd: 0.78 }),
      createdAt: ago(27 * H),
    },
    {
      goalId: gActive.id,
      type: "dod",
      payload: JSON.stringify({ id: "d1", done: true }),
      createdAt: ago(26 * H),
    },
    {
      goalId: gActive.id,
      type: "decision",
      payload: JSON.stringify({
        agentName: "senior-dev",
        why: "The container is the only thing worth losing",
        task: "Inertia pause and relaunch",
      }),
      createdAt: ago(25 * H),
    },
    {
      goalId: gActive.id,
      type: "task_done",
      payload: JSON.stringify({ task: "Inertia pause and relaunch", costUsd: 2.87 }),
      createdAt: ago(9 * H),
    },
    {
      goalId: gActive.id,
      type: "dod",
      payload: JSON.stringify({ id: "d2", done: true }),
      createdAt: ago(8 * H),
    },
    {
      goalId: gStopped.id,
      type: "rail",
      payload: JSON.stringify({
        rail: "no-progress",
        streak: 3,
        detail: "3 iterations without the DoD moving",
      }),
      createdAt: ago(3 * DAY),
    },
    {
      goalId: gCompleted.id,
      type: "status",
      payload: JSON.stringify({ status: "completed" }),
      createdAt: ago(7 * DAY),
    },
  ]);

  // ── In-app notices (standup without Discord) ──
  insertNoticeRows([
    {
      id: id(),
      kind: "standup",
      read: false,
      createdAt: ago(7 * H),
      body: "☀️ **Legion standup** — last 24 h\n• Goals: 0 finished, 0 stopped, 1 running\n• Change requests: 2 open\n• Sessions: 9 (1 failed) · cost ~$7.18\n• 2 approval gates waiting\n• ❓ 2 inbox questions waiting",
    },
    {
      id: id(),
      kind: "info",
      read: true,
      createdAt: ago(2 * DAY),
      body: "Rule suggested from a correction: “Every `.tsx` module carries its `.stories.tsx` next to it.” — approve it in Library.",
    },
  ]);

  log.info("project “Demo (mock)” created", { projectId });
  log.info(
    `${allTasks.length} tasks · ${sessions.length} sessions · 4 goals · 2 open inbox questions`,
  );
  log.info(`open http://localhost:5173/p/${projectId}/board`);
}

const dropOnly = process.argv.includes("--drop");
dropDemo();
if (!dropOnly) seedDemo();
raw.close();
