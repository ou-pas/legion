// session-runner — the process that lives INSIDE the throwaway runtime.
// Phase 2: Legion MCP tools (task, filesystem with server-side ACL, inbox with
// pause/resume), proxied callbacks in "limited" networks, resume mode.

// Order matters: the proxy first (it depends on nothing), the spec next. Since the `docker inspect`
// hardening the spec is fetched over HTTP from the control plane, and in a limited network that call
// must already go through the proxy.

// Type imports are grouped here and erased at compile time, so they do not affect the load order
// protected above. Value imports stay where they are, with the reason that put them there.
import type { SessionRepo } from "./repos.mjs";
import type { CallResult, Sleep } from "./runner-io.mjs";
import type { SessionSpec } from "./session-spec.mjs";
import type { EndedTurn } from "./turn-tracker.mjs";
import type { TurnBudgetEvent } from "./turn-budget.mjs";

// In a "limited" network, even control-plane callbacks must go through the proxy —
// Node's global fetch ignores proxy env vars, so we use undici's ProxyAgent explicitly.

/** What this file asks of `fetch`, and no more. The global `fetch` and undici's have distinct types
 *  that do not unify (their `Request` and streams differ); both satisfy this shape, the only one the
 *  runner uses: a URL, a method, headers, a body, then `ok`, `status` and `json()`. */
type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let doFetch: Fetch = fetch;
if (process.env.LEGION_PROXY) {
  try {
    const { fetch: ufetch, ProxyAgent } = await import("undici");
    // proxyTunnel:false → absolute-form HTTP through the proxy. Without it, undici
    // CONNECT-tunnels even plain http and tinyproxy (ConnectPort 443) refuses (review #1).
    const dispatcher = new ProxyAgent({ uri: process.env.LEGION_PROXY, proxyTunnel: false });
    doFetch = (url, init = {}) => ufetch(url, { ...init, dispatcher });
  } catch (err) {
    console.error(
      "undici unavailable, callbacks may fail through the proxy:",
      (err as Error)?.message,
    );
  }
}

/** The spec holds the authentication token, the secrets granted to the agent and resolved MCP
 *  headers, so it no longer travels in the container's environment, where any `docker inspect` read
 *  it: the container gets a URL and a single-use nonce and fetches it. `LEGION_SPEC` is still
 *  accepted for the development ProcessRunner, which has no container to inspect. */
async function loadSpec(): Promise<SessionSpec> {
  const url = process.env.LEGION_SPEC_URL;
  const boot = process.env.LEGION_BOOT;
  if (!url || !boot) return JSON.parse(process.env.LEGION_SPEC ?? "{}") as SessionSpec;
  // The control plane may not be reachable the millisecond the container starts (freshly created
  // internal network, proxy coming up). A few quick retries, but never after a 410: the nonce is
  // single-use, retrying can no longer succeed.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await doFetch(url, { headers: { "x-legion-boot": boot } });
      if (res.ok) return (await res.json()) as SessionSpec;
      if (res.status === 410) {
        console.error("boot refused: unknown, stale or already used nonce");
        process.exit(1);
      }
      throw new Error(`spec HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 5) {
        console.error("session spec not found:", (err as Error)?.message ?? err);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  // Unreachable: the fifth attempt exits the process. The line keeps the return type honest: this
  // function returns a spec or never returns.
  throw new Error("boot: the loop ended without a spec and without exiting");
}

const spec = await loadSpec();
if (!spec?.sessionId) {
  console.error("empty or invalid session spec");
  process.exit(1);
}

// Credentials enter here, in the process's environment, not the container's. `docker inspect` only
// shows the creation config: what a process later adds to its own environment stays private.
Object.assign(process.env, spec.env ?? {});

const base = `${spec.callbackUrl}/internal/sessions/${spec.sessionId}`;
const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${spec.callbackToken}`,
};

async function callInternal(pathname: string, body: Record<string, unknown>): Promise<CallResult> {
  try {
    const res = await doFetch(`${base}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return {
      ok: res.ok,
      status: res.status,
      body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
    };
  } catch (err) {
    console.error(`callInternal(${pathname}) failed:`, (err as Error)?.message ?? err);
    return { ok: false, status: 0, body: {} };
  }
}
// The session's event log: numbered, acknowledged, replayed.
// `report` used to be one line: a POST to /events, no number, no acknowledgement. A failed POST lost
// its sentence and the control plane had no way to know one was missing. That was the 26/08 outage
// ("container gone without a reported result"): the session had spoken, nothing got through, and the
// screen concluded failure without saying anything else.
//
// Now each event carries a number, the server returns an acknowledgement, and the queue only drops
// what is acknowledged. A server restarting during a report costs only a round trip of delay.
//
// What it does not do: survive the container's death. The queue is in memory and leaves with it. An
// on-disk log next to the agent would need a volume outliving the session (D13 of the discussion
// mode spec), which did not exist when this was written.
//
// The counter resumes where the previous run stopped, not from zero (08/09).
//
// `seq` is unique per session, not per container, and a session spans several: each pause destroys
// the container, each resume creates a new one under the same session id. A counter reset to zero
// re-emitted numbers already stored, which the server refuses by design (`publishSeq`, unique
// index). It then answers `{ ok: true, duplicate: true, ack: <highest known number> }`, the queue
// empties against that acknowledgement, and everything the resumed container had to say vanished
// without a line, until it had emitted more events than the previous run.
//
// Seen on 08/09 on AI-2200: the resumed session produced a full situation report and asked its
// question, 156 numbers behind the first run. Nothing got through. The task was filed "delivered"
// on the strength of the single push the pause had made. The only path still visible was `status`,
// published by the control plane itself with a null `seq`.
//
// `spec.seqBase` is what the server had already heard when building the spec (`ackOf`). Zero on first
// launch, by construction.
let nextSeq = spec.seqBase ?? 0;
let acked = nextSeq;
/** A queued event: its number, its type, and what it carries. */
type QueuedEvent = { seq: number; type: string; payload?: Record<string, unknown> };
/** What the server has not acknowledged yet, in order. */
const outbox: QueuedEvent[] = [];
/** Memory bound: beyond it the oldest are dropped, and that is said. An unbounded queue would bring
 *  the container down during a long control plane outage, exactly what we want to avoid. The lost
 *  count goes out in the first report that gets through: a silent loss would read as a complete
 *  trace. */
const OUTBOX_MAX = 1000;
let dropped = 0;

async function drainOutbox() {
  // "while there is a head" rather than "while the length is non-zero": same condition, and this one
  // gives the event instead of fetching it again by index.
  for (let ev = outbox[0]; ev !== undefined; ev = outbox[0]) {
    const res = await callInternal("/events", ev);
    // Network failure or server restarting: keep the queue. The next report resumes it from the
    // head, in order.
    if (!res.ok) return;
    const ack = Number.isInteger(res.body?.ack) ? Number(res.body.ack) : ev.seq;
    acked = Math.max(acked, ack);
    for (let head = outbox[0]; head !== undefined && head.seq <= acked; head = outbox[0])
      outbox.shift();
  }
}

/** The last drain, retried (08/09): what the numbered queue needed to keep its promise.
 *
 *  The header above says a server restarting during a report "costs only a round trip of delay".
 *  That held as long as another event followed: `drainOutbox` gives up at the first failure and
 *  `report` drains once, so recovery was carried by the next report. The last one has none, and the
 *  last one is the `result`, without which the sweep concludes "container gone without a reported
 *  result" and files a successful session as failed.
 *
 *  A control plane update lasts one to three minutes (`up.sh --build`), hence the cap. Backoff is
 *  exponential and bounded: a server that does not come back must not hold a container forever; a
 *  lost trace costs less than a blocked runner slot.
 *
 *  It also covers a reloading `tsx watch`, a control plane OOM, an ssh hiccup: all produced the same
 *  false failure. */
async function flushOutbox(maxMs = 180_000) {
  let wait = 500;
  const deadline = Date.now() + maxMs;
  await drainOutbox();
  while (outbox.length && Date.now() < deadline) {
    await sleep(Math.min(wait, deadline - Date.now()));
    wait *= 2;
    await drainOutbox();
  }
  if (outbox.length)
    console.error(
      `${outbox.length} event(s) never acknowledged: the control plane did not come back`,
    );
}

async function report(type: string, payload?: Record<string, unknown>): Promise<void> {
  outbox.push({ seq: ++nextSeq, type, payload });
  while (outbox.length > OUTBOX_MAX) {
    outbox.shift();
    dropped += 1;
  }
  await drainOutbox();
  // Recovered: admit the gap rather than let the trace look continuous.
  if (dropped > 0 && outbox.length === 0) {
    const n = dropped;
    dropped = 0;
    outbox.push({
      seq: ++nextSeq,
      type: "run_warning",
      payload: {
        message: `${n} event(s) lost: the control plane stayed unreachable for too long`,
      },
    });
    await drainOutbox();
  }
}
async function updateTask(body: { status?: string; note?: string }): Promise<CallResult> {
  const res = await doFetch(`${base}/task`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, body: {} };
  return {
    ok: res.ok,
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Steering: the human talks to a running session.
// Nothing on the control plane opens a connection to this container: that is the invariant, and also
// why there is no TTY here. The runtime fetches, on the callback channel it already uses (same URL,
// same token, no extra port). The server holds the request until it has something to say, so
// near real time without tight polling.
const STEER_WAIT_MS = 20_000;

/** A pause requested by the operator (26/08). The flag travels on the steering channel, already
 *  polled with the same token and URL; a second channel for a boolean would be one more port to
 *  secure for nothing.
 *
 *  It is raised here and honoured at a turn boundary, where checkpoints already happen. Never
 *  mid-turn: the model answer just paid for would be lost. */
let pauseAsked = false;

/** One pass: returns messages received, or null if the session no longer listens (ended, or token
 *  refused). `[]` = nobody said anything during the window, the normal case. The pause flag is read
 *  on the way, without a round trip of its own. */
async function pollSteers(waitMs = STEER_WAIT_MS) {
  const res = await callInternal("/steer", { waitMs });
  if (!res.ok) {
    // 401/404: no longer (or never) our session, insisting cannot help.
    if (res.status === 401 || res.status === 404) return null;
    return []; // network hiccup or 5xx: the caller waits and retries
  }
  if (res.body?.listening === false) return null;
  // Once raised it is not lowered: the request was made and will be honoured next turn. A later
  // `pause: false` must not cancel it.
  if (res.body?.pause === true) pauseAsked = true;
  return Array.isArray(res.body?.messages) ? res.body.messages : [];
}

/** Background loop: each injected message goes to `onMessage`. `stop()` ends it. */
function startSteerPump(onMessage: (m: { text: string }) => Promise<void>) {
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      const msgs = await pollSteers();
      if (stopped) return;
      if (msgs === null) return; // the session no longer listens
      if (msgs.length === 0) {
        // Nothing received: either the wait window passed (restart at once) or the server hiccuped
        // (wait so as not to hammer it). The two are not told apart: 300 ms of rest costs less than
        // a tight loop during an outage.
        await sleep(300);
        continue;
      }
      for (const m of msgs) await onMessage(m);
    }
  })();
  return {
    stop: () => {
      stopped = true;
    },
    done,
  };
}

// ---------------- git: state travels through branches, not containers ----------------
// The git steps (clone, cleanup, checkpoint, push) live in repos since 06/09: 336 lines talking only
// to git, needing only the spec and the log from here, carried by `repoIO`, composed once.
//
// `readArtifact` joined with checkpoint merging: when a session made only checkpoints, the final
// commit's subject comes from the task's PR draft. The git domain needs it but only talks to git;
// internal API access stays here, and it receives a function, not a client.
import { checkpointRepos, pushRepos, setupRepos } from "./repos.mjs";
const repoIO = {
  spec,
  report,
  /** A task artifact's raw content, or `null` (missing, empty, or the call failed). None of the
   *  three must fail a push: the caller falls back. */
  readArtifact: (path: string) =>
    callInternal("/fs", { op: "read", path })
      .then((res) => (res.ok && typeof res.body?.result === "string" ? res.body.result : null))
      .catch(() => null),
};

// ---------------- real sessions: Claude Agent SDK ----------------
async function runReal() {
  const { query, createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
  const { createStuckWatch } = await import("./stuck.mjs");
  const { createTurnBudgetWatch } = await import("./turn-budget.mjs");
  // What counts a turn: one place for the guardrails (checkpoint, turn budget), and the only module
  // knowing the SDK's message shape. See its header: the `stop_reason != null` condition that lived
  // here had switched them all off.
  const { createTurnTracker, CHECKPOINT_EVERY_TURNS } = await import("./turn-tracker.mjs");
  // The SDK can return `subtype: "success"` on a turn that actually ended on an API error (529,
  // quota, auth, network); see turn-outcome's header. `is_error` is the only field that does not lie.
  const { endsNothing, turnFailed, resultEventFields } = await import("./turn-outcome.mjs");
  // What the SDK's message shapes mean (assistant turn content, tool results, quota state). Pure,
  // moved out of the loop on 06/09: the file's six nesting levels lived there.
  const { assistantEvents, toolResults, rateLimitFields } = await import("./sdk-events.mjs");
  // What the SDK is granted and refused: the session's permission model, declarative, moved out of
  // the loop on 06/09.
  const { buildQueryOptions } = await import("./sdk-options.mjs");
  // Created here rather than below with the other guardrails: its thresholds enter the prompt,
  // built a few lines further. An agent unaware of its budget cannot arbitrate its scope, which is
  // what launched a ten-minute check three turns from the wall on 25/08.
  const turnBudget = createTurnBudgetWatch({ warnAt: spec.turnWarnAt, pauseAt: spec.turnPauseAt });
  const { createInputStream } = await import("./steer-stream.mjs");
  // `setupRepos` is fatal since 20/08 and called before the try/catch that reports `run_error`:
  // without this catch the failure left runReal() as an unhandled rejection and the container died
  // with no reason reported, a silent death strictly less useful than the warning it replaced.
  let repos: SessionRepo[];
  try {
    repos = await setupRepos(repoIO);
  } catch (err) {
    await report("run_error", { message: String((err as Error)?.message ?? err) });
    process.exit(1);
  }

  const abort = new AbortController();
  let pausing = false;
  /** The only voluntary pause path, which matters more than the three lines it saves. `pausing`
   *  makes the catch push the work in progress and exit 0; every extra place that stops is one more
   *  place to forget the push.
   *
   *  The 400 ms let the current result land before the abort: without them a tool that just
   *  answered has its answer cut, and the agent resumes without it.
   *
   *  External stop (SIGTERM) does not come through here: it has nothing to let land, and twenty
   *  seconds of grace to honour. */
  // Who cut the tools (14/09). Once `abort` fires, every later tool call dies with "The tool call was
  // interrupted before a result was received", and the agent keeps going, retrying dead tools, with
  // nothing telling it why. The defect seen on task `-Nc3BM3P8S` on 08/09, where the tool warning
  // comment admits "the cause is not established".
  //
  // It was not because nothing recorded it: three paths arm the same controller (voluntary pause,
  // external stop, finish net), and once armed it does not say which. So it is kept and attached to
  // tool warnings, where the symptom is read. No guardrail here: measure the cause first.
  let abortReason: "pause" | "stop" | "finish-timer" | null = null;
  const abortNow = (reason: typeof abortReason) => {
    abortReason ??= reason;
    abort.abort();
  };

  const pauseSession = () => {
    pausing = true;
    setTimeout(() => abortNow("pause"), 400);
  };

  /** A failing Legion tool's warning, with its cause when known.
   *
   *  "interrupted before a result was received" does not say who cut, exactly what was missing on
   *  08/09 (task `-Nc3BM3P8S`) to establish the cause. `abortReason` is read at call time, not
   *  definition: at the first failure it is often still null, a useful fact saying the cut did not
   *  come from us. */
  const legionToolWarning = (tool: unknown, error: unknown) =>
    `Legion tool “${String(tool)}” failed: ${String(error ?? "no reason reported").slice(0, 300)}` +
    (abortReason ? ` — tools have been cut since “${abortReason}”` : "");

  /** The only invisible one of the three paths, and the suspect in interview `ZLgdmCRLgqkR`: it fires
   *  thirty seconds after a `result` without saying so, and a CLI doing one more turn finds itself
   *  without tools mid-work. */
  const finishNet = () => {
    void report("run_warning", {
      message:
        "finish net: thirty seconds without a word from the CLI after the result, tools are cut",
    });
    abortNow("finish-timer");
  };

  // The MCP tools (245 lines of schemas and descriptions) live in mcp-tools since 06/09. What stays
  // here is the runner's own part: what "pause" means, i.e. return the tool result then abort.
  const { buildTools } = await import("./mcp-tools.mjs");
  const { z } = await import("zod");
  const tools = buildTools({
    // `tool` and `z` come from here: `runner-payload/` has no `node_modules` of its own, so importing
    // the SDK or zod in mcp-tools would make it unimportable outside a container. The runner runs
    // where `NODE_PATH` finds them.
    tool,
    z,
    spec,
    callInternal,
    updateTask,
    pause: pauseSession,
  });

  const legion = createSdkMcpServer({ name: "legion", version: "0.2.0", tools });

  // What the session tells the model lives in prompt since 06/09: the task prompt here, system
  // sections at SDK call time. Pure, so tested by calling it.
  const {
    buildTaskPrompt,
    buildSystemPrompt,
    turnWarningText,
    relaunchNoticeText,
    uncommittedNoticeText,
  } = await import("./prompt.mjs");
  // Inertia, not length (rule in inertia, tested).
  // What decides is no longer the turn count but what the session produced: a commit pushed by a
  // checkpoint, or a successful tool write. Created here because its threshold enters the prompt,
  // like the turn budget's above.
  //
  // `writable` is decidable without heuristics (decision D6): each spec repository carries its
  // effective access, already lowered to "read" for a read-only task (manager.ts). A session writing
  // no repository gets no inertia pause: it cannot break anything, and thirty turns reading code is
  // normal work.
  const { createInertiaWatch, INERTIA_STALE_TURNS } = await import("./inertia.mjs");
  const inertia = createInertiaWatch({ writable: (repos ?? []).some((r) => r.access === "write") });
  const prompt = buildTaskPrompt({
    spec,
    repos,
    turnBudget,
    checkpointEveryTurns: CHECKPOINT_EVERY_TURNS,
    inertiaStaleTurns: INERTIA_STALE_TURNS,
  });

  // cwd = workdir: repositories live in ./repos/<name>, skills in ./.claude/skills, outside any
  // repository, so outside the end-of-session git add -A.
  const cwd = process.env.LEGION_WORKDIR ?? process.cwd();

  // What the session puts on its disk (`.claude/` exclusion, skills, rule bodies merged with the
  // repositories') lives in capabilities since 06/09.
  const { loadCapabilities } = await import("./capabilities.mjs");
  const { skillNames, rulesSection } = await loadCapabilities({ spec, cwd, repos, report });

  // The SDK's two in-process hooks (loaded instruction trace, and advice on an off-convention
  // `git commit`) live in session-hooks since 06/09.
  const { createSessionHooks } = await import("./session-hooks.mjs");
  const sdkHooks = createSessionHooks({ cwd, report });

  const externalMcp = spec.mcpServers && typeof spec.mcpServers === "object" ? spec.mcpServers : {};
  if (Object.keys(externalMcp).length)
    await report("capabilities", { mcpServers: Object.keys(externalMcp) });

  // Stuck detector (rule in stuck, tested).
  // The turn cap punished a task for being big: it killed a session that had just got lint,
  // typecheck, tests and build passing. This detector only reacts to running in place, the same call
  // made identically with nothing changed between attempts.
  //
  // On detection nothing is killed, a question is asked. The runtime is destroyed during the wait
  // (nothing costs), the work is pushed, and the answer relaunches the session with the human's
  // instruction, which is the fix the model needed. It reuses `inbox_ask`'s proven pause path.
  const stuck = createStuckWatch();
  let paused = false;
  const pendingCalls = new Map(); // tool_use_id → { tool, input }

  // The turn since which inertia was already signalled to the agent, or `null` (11/09).
  // `verdict.sinceTurn` identifies the episode: it does not move while nothing is produced, and
  // changes as soon as a commit or write restarts the count. Comparing against it avoids asking again
  // every turn while an inert session waits for an answer, and lets a session that recovers then
  // falls back ask again, its `sinceTurn` having changed.
  let inertiaNudgedSinceTurn: number | null = null;

  // So the inbox question says what the session was doing, not just that it passed a number; without
  // it the human must reopen the trace to decide. Read by `askTurnBudget` and `askStuck`.
  let lastActivity = "(nothing yet)";

  // The pause questions live in pause-guards since 06/09 (three until 08/09, when the token budget
  // left). They made the same move in thirty-line blocks never read together. `lastActivity`
  // travels as a function: its value moves with every message, and a capture here would always say
  // "(nothing yet)".
  const { askStuck, askTurnBudget, requestRelaunch } = await import("./pause-guards.mjs");
  const guardIO = {
    callInternal,
    report,
    pause: pauseSession,
    lastActivity: () => lastActivity,
  };

  // The prompt becomes a stream (v23).
  // Same content for the first turn; the difference is keeping hold of the input after giving it.
  // Everything the human injects while the agent works enters there, as an ordinary user turn, which
  // makes it visible in the SDK's conversation and not only in our trace.
  //
  // The catch, and the only thing that matters here: a stream does not end on its own. Until it is
  // closed the SDK waits for the next message. Closing is triggered by `result` (end of turn = end of
  // work, the former semantics), backed by a net that gives up if the CLI does not exit.
  const promptStream = createInputStream(prompt);
  const steerPump = startSteerPump(async (m) => {
    if (!promptStream.push(m.text))
      await report("run_warning", {
        message: `injected message arrived after the end of the turn, NOT passed to the agent: ${String(m.text).slice(0, 160)}`,
      });
  });
  steerPump.done.catch((err) =>
    report("run_warning", {
      message: `steering loop interrupted: ${String((err as Error)?.message ?? err)}`,
    }),
  );

  // One turn counter for the guardrails. The tracker knows what a turn end is (turn-tracker: one turn
  // = one `message.id`) and advances the budget in the same move. Nothing here recounts: the 03/09
  // defect was guardrails hanging on the same never-true test, and one counter per guardrail would
  // only multiply the places to get it wrong.
  const turns = createTurnTracker({ turnBudget });

  /** What a finished turn triggers. The order matters:
   *  1. code secured before any decision, so a brutal stop during what follows costs nothing; 2. the
   *  agent warned, deciding for itself; 3. the net; 4. the human's pause request, last because it
   *  cancels nothing. */
  // The net warns before taking (10/09): the checkpoint tells the agent what it left lying around and
  // only commits in its place at the next checkpoint if nothing was done. Same channel as the budget
  // warning (the input stream), doubled by a `run_warning` so the trace keeps the warning even when
  // the agent ignores it.
  const checkpointIO = {
    ...repoIO,
    nudge: async (repoName: string, files: string[]) => {
      await report("run_warning", {
        message: `${files.length} uncommitted file(s) in ${repoName} — the agent is asked to commit them itself before the safety net does`,
      });
      if (!promptStream.push(uncommittedNoticeText(repoName, files)))
        await report("run_warning", {
          message: `commit invitation NOT passed on (turn already closed) — ${repoName}`,
        });
    },
  };

  async function onTurnEnd(ended: EndedTurn) {
    const pushed = ended.checkpoint
      ? await checkpointRepos(checkpointIO, repos, ended.used, ended.checkpoint.reason)
      : 0;
    // What this turn produced: the commits the checkpoint just pushed, and the successful write count
    // stuck already keeps.
    inertia.record({ turn: ended.used, commits: pushed, writeVersion: stuck.stateVersion });

    // Inertia is asked about as soon as it is true, not at the pause turn (11/09).
    // This verdict used to be read only at the pause turn (175, then 375): a session broken at turn 40
    // burned the rest of its budget with nobody, agent or operator, told. `idleTurns` is true long
    // before, and it is what triggers, not the budget's turn count. `inertiaNudgedSinceTurn` bounds it
    // to once per episode (see its declaration above).
    const idle = inertia.verdict(ended.used);
    if (idle.inert && inertiaNudgedSinceTurn !== idle.sinceTurn) {
      inertiaNudgedSinceTurn = idle.sinceTurn;
      await report("inertia_warning", {
        turn: ended.used,
        idleTurns: idle.idleTurns,
        sinceTurn: idle.sinceTurn,
        staleTurns: idle.staleTurns,
      });
      // Same text as the budget warning (`turnWarningText`): what it says and the three ways out it
      // leaves (fix, ask, hand over) do not change, only when it leaves. The `hit` is synthetic (no
      // turn budget event happened this turn), built on the counter's real thresholds so the text
      // cites real numbers, not zeros.
      const hit: TurnBudgetEvent = {
        kind: "warn",
        used: ended.used,
        warnAt: turnBudget.warnAt,
        pauseAt: turnBudget.pauseAt,
        cap: turnBudget.cap,
        left: turnBudget.left,
      };
      if (!promptStream.push(turnWarningText(hit, idle)))
        await report("run_warning", {
          message: `inertia warning NOT passed on (turn already closed)`,
        });
    }
    // `push` may refuse if the turn is already closed: say so rather than believe the agent was told.
    if (ended.turn?.kind === "warn") {
      const turn = ended.turn;
      await report("turn_budget_warning", {
        used: turn.used,
        left: turn.left,
        pauseAt: turn.pauseAt,
        cap: turn.cap,
      });
      // An already inert session just got its notice above, this turn or earlier: repeating it here
      // would ask again for the same episode, which "one question per episode" forbids. The turn budget
      // then only has one thing to say (that it is approaching), and only if the session still moves.
      if (!idle.inert && !promptStream.push(turnWarningText(turn, idle)))
        await report("run_warning", {
          message: `turn budget warning NOT passed on (turn already closed)`,
        });
    }
    if (ended.turn?.kind === "pause") {
      // The verdict is taken after this checkpoint, and the order is the point: a session working in
      // Bash (heredoc, build, manual `git commit`) moves no tool write counter, but its tree changed,
      // and this push proves it. Taking the verdict before would declare it inert just for not using
      // `Write`.
      const pushedAtPause = await checkpointRepos(checkpointIO, repos, ended.used, "pause");
      inertia.record({
        turn: ended.used,
        commits: pushedAtPause,
        writeVersion: stuck.stateVersion,
      });
      const verdict = inertia.verdict(ended.used);
      // Moving: it restarts alone, no question and no click (decision D4). The 400 wall stays in each
      // session: a long run is N bounded sessions, not one session stretched. No `inboxEnabled` guard:
      // this is not a question, and an agent without inbox has the same right to finish its work.
      //
      // Not moving: the usual inbox question, unchanged.
      if (!verdict.inert) {
        if (
          await requestRelaunch(
            guardIO,
            ended.turn,
            verdict,
            relaunchNoticeText(ended.turn, verdict),
          )
        )
          paused = true;
      } else if (spec.inboxEnabled && (await askTurnBudget(guardIO, ended.turn))) paused = true;
    }
    // `operator_pause` is the fact the control plane waits for before asking the inbox question;
    // without it a session that finished its work while the pause was requested would be paused for
    // nothing.
    if (pauseAsked && !paused && !pausing) {
      await report("operator_pause", { turn: ended.used });
      // Same exit as the other watchers, not a `break` of our own: `pausing` makes the catch push the
      // work in progress and exit 0, and the control plane asks the inbox question
      // (operator-pause.ts). One more exit path would be one more place to forget the push.
      pauseSession();
    }
  }

  let exitCode = 0;
  let finishing = false;
  let finishTimer = null;
  const endInput = () => {
    steerPump.stop();
    promptStream.close();
  };

  // Stop requested from outside: SIGTERM, SIGINT (05/09).
  // This process listened to no signal. It is PID 1 in the container (the entrypoint execs node), and
  // Linux does not deliver to PID 1 a signal with the default disposition: `docker stop` waited out
  // its grace then SIGKILLed, and the operator's `rm -f` killed outright. Either way unpushed work died
  // with the container: `pushRepos` only runs at loop exit, never reached on an external death, and
  // the last net was the periodic checkpoint, up to fifteen turns or ten minutes of work lost without
  // a trace. The server's `destroy` now sends SIGTERM with thirty seconds of grace before `rm -f`;
  // here it is heard.
  //
  // Same exit as the watchers, not one more path: `pausing = true`, then abort. The abort stops the
  // CLI (so no more writes to the tree during the commit) and the catch below does the rest:
  // `pushRepos`, then `process.exit(0)`, which skips the finally block. The push is therefore unique:
  // the end-of-loop one is never reached. A handler calling `checkpointRepos` itself would run git on
  // the same index as a still-living agent. The catch-up commit says what it is
  // (`chore: end of session — uncommitted work`): the session does end.
  //
  // Installed here, right before `query()`, not earlier: it needs `repos`, `abort` and `pausing`, and
  // before the first turn there is nothing to save (the clone was just made, a wake-up starts from an
  // already pushed branch). There is no `await` between `process.on` and `query()`, so no signal can
  // be handled before the SDK installs its listener.
  //
  // Bounded to twenty seconds of the thirty of grace. The catch has no cap: a push that does not
  // progress, a `report` to a silent control plane, and we would be SIGKILLed mid-push without a word.
  // At the deadline we say so, then exit; the branch needs checking, but the trace says it. Idempotent:
  // an impatient operator's second signal restarts nothing.
  const STOP_GRACE_MS = 20_000;
  let stopping = false;
  function stopRequested(signal: NodeJS.Signals) {
    if (stopping) return;
    stopping = true;
    void report("run_warning", {
      message: `stop requested (${signal}): the work in progress is pushed before exiting`,
    });
    pausing = true;
    abortNow("stop");
    const deadline = setTimeout(async () => {
      await Promise.race([
        report("run_warning", {
          message:
            `stop requested (${signal}): ${STOP_GRACE_MS / 1000} s elapsed without finishing the push — ` +
            `forced exit, branch ${spec.repoBranch} needs checking`,
        }),
        sleep(2_000),
      ]);
      process.exit(0);
    }, STOP_GRACE_MS);
    deadline.unref?.();
  }
  process.on("SIGTERM", stopRequested);
  process.on("SIGINT", stopRequested);

  try {
    const q = query({
      prompt: promptStream,
      options: buildQueryOptions({
        spec,
        cwd,
        legion,
        externalMcp,
        skillNames,
        abort,
        systemPrompt: buildSystemPrompt({ spec, cwd, repos, rulesSection }),
        hooks: sdkHooks.hooks,
      }),
    });
    for await (const msg of q) {
      // The net armed after a `result` (see below) only targets "the CLI does not exit". Any message
      // proves it is not stuck, so the net is disarmed; otherwise an extra turn triggered by a
      // last-second injected message would be killed mid-execution.
      if (finishTimer) {
        clearTimeout(finishTimer);
        finishTimer = null;
      }
      // Turn end. The runner no longer recognises it itself: it feeds the tracker every message and
      // executes what it returns. That is the whole 03/09 fix: recognition lived here under a condition
      // (`stop_reason != null`) the stream path never produces, and the guardrails depending on it were
      // silently off together. A turn can end on an assistant message as well as on `result`, hence
      // the call before sorting by type, and before reporting the message's content (which already
      // belongs to the next turn).
      for (const ended of turns.observe(msg)) {
        await onTurnEnd(ended);
        if (paused) break;
      }
      if (paused) break;
      if (msg.type === "system" && msg.subtype === "init")
        await report("init", {
          sdkSessionId: msg.session_id,
          model: msg.model,
          apiKeySource: msg.apiKeySource,
          resumed: Boolean(spec.resume),
        });
      else if (msg.type === "assistant") {
        for (const e of assistantEvents(msg)) {
          if (e.call)
            pendingCalls.set(e.call.id, {
              tool: e.call.tool,
              input: e.call.input,
              sub: e.call.sub,
            });
          lastActivity = e.activity;
          await report(e.type, e.payload);
        }
      } else if (msg.type === "user") {
        for (const r of toolResults(msg)) {
          await report("tool_end", {
            ok: r.ok,
            id: r.toolUseId,
            ...(r.error ? { error: r.error } : {}),
            ...(r.result ? { result: r.result } : {}),
          });
          const call = pendingCalls.get(r.toolUseId);
          // A failing Legion tool is an outage, not a result (08/09). A `Bash` returning 1 or a `Grep`
          // finding nothing are answers; a failing `mcp__legion__*` means the session can no longer
          // talk to the control plane (no artifact, no proposed task, no question), and that cannot be
          // fixed from inside. Task `-Nc3BM3P8S`: `inbox_ask` then six `fs_write` interrupted while
          // `Grep` and `Write` answered, `subtype: "success"` without `is_error`, and the task filed
          // delivered when nothing was. Say it without deciding anything: the cause is not established,
          // and a guardrail built on a hypothesis gets it wrong.
          if (call && !r.ok && String(call.tool).startsWith("mcp__legion__"))
            await report("run_warning", { message: legionToolWarning(call.tool, r.error) });
          pendingCalls.delete(r.toolUseId);
          const hit = call ? stuck.record({ ...call, ok: r.ok }) : null;
          // `paused` and not a lone `break`: a break would only leave this results loop, and the
          // message loop would keep running on a session just paused. The `if (paused) break` at the
          // bottom of the loop exits it.
          if (hit && spec.inboxEnabled && (await askStuck(guardIO, hit))) {
            paused = true;
            break;
          }
        }
        if (paused) break;
      } else if (msg.type === "rate_limit_event") {
        const quota = rateLimitFields(msg);
        await report("throttle", quota.payload);
        // v33: stop at the first refusal. `rejected` means the subscription window is exhausted:
        // every following turn will be refused identically. Without this guard the SDK restarts the
        // conversation (`init`) and retries in a loop; seen on 24/08 on the i18n session: 20 minutes
        // going in circles, 11 `init`s, 9 refusals, before the CLI gave up. The server's quota pause
        // only triggered at that point, so very late.
        // Here we cut short, same path as the other watchers (stuck, budget): `pausing` makes the work
        // in progress be pushed then exit 0, and the control plane asks the dated inbox question
        // (quota-pause.ts) because the wake-up time is computed on the server. So no question here:
        // two would ask twice.
        if (quota.exhausted && !pausing) {
          await report("run_warning", {
            message:
              `out of quota (${quota.window}) — immediate stop at the first refusal: ` +
              `the work in progress is pushed, the session will sleep until the reset`,
          });
          pauseSession();
        }
      } else if (msg.type === "system" && msg.subtype === "api_retry") {
        await report("throttle", { kind: "api_retry" });
      } else if (msg.type === "result") {
        await report("result", resultEventFields(msg));
        if (turnFailed(msg)) exitCode = 1;
        // The turn is over: close the input, which makes the CLI exit. Without it the stream keeps
        // the session alive waiting for a message that will not come: the stream's trap, defused here.
        //
        // A message injected at the last second may have been read by the CLI before this closing: it
        // then does one more turn and a second `result`. Closing is idempotent, and the net below is
        // disarmed by the first message of that extra turn (see the top of the loop).
        //
        // Except when this `result` ends nothing (14/09). The extra turn then ran without tools,
        // because the input was already closed. `endsNothing` names the only case where the message
        // concludes no work (see its measure in `turn-outcome.mts`). The net is armed anyway: a CLI
        // that really has nothing more to say must not run forever, and the next turn's first message
        // disarms it.
        finishing ||= !endsNothing(msg);
        if (finishing) endInput();
        // Net. If the CLI did not exit despite closed input, a container would run forever on work
        // already reported, far worse than giving up plainly.
        finishTimer = setTimeout(finishNet, 30_000);
        finishTimer.unref?.();
      }
      // Net for the remaining trigger: running in place, found inside the `user` block loop (see
      // above, with its own `break` explained); without this line its `break` would only leave that
      // loop. Turn budget pauses are found at turn end, at the top of the loop, and exit there.
      if (paused) break;
    }
  } catch (err) {
    if (pausing || (abort.signal.aborted && !finishing)) {
      // deliberate pause after inbox_ask — push work-in-progress so the resume container finds it
      // Or a stop requested from outside (SIGTERM, 05/09): same move, the work goes to the branch
      // before the container dies. `process.exit` here skips the finally block and the end-of-loop
      // `pushRepos`, which guarantees a single push.
      endInput();
      await pushRepos(repoIO, repos);
      // The trace before dying: this container is the only one carrying it (the queue is in memory).
      await flushOutbox();
      process.exit(0);
    }
    // `finishing`: the result is already reported and the input closed; the CLI's exit was merely
    // abrupt. Not a run error, and announcing it as one would make a successful session look failed.
    if (!finishing) {
      await report("run_error", { message: String((err as Error)?.message ?? err) });
      exitCode = 1;
    }
  } finally {
    if (finishTimer) clearTimeout(finishTimer);
    endInput();
    // v61: the last batch of loaded instructions, if one is still in its window. The timer is
    // `unref()` so it does not hold the process: without this flush a session ending within half a
    // second of a load would lose its trace, precisely the short session one looks at to check native
    // loading works.
    sdkHooks.cancel();
    await sdkHooks.flush().catch(() => {});
  }
  await pushRepos(repoIO, repos);
  // The last `result` has no later report to rescue it: here, and nowhere else, the numbered queue
  // earns the right to insist.
  await flushOutbox();
  process.exit(pausing ? 0 : exitCode);
}

if (spec.mock) {
  // The mock session lives in mock-run since 06/09: it shares nothing with runReal but the channels
  // to the control plane, and having them side by side suggested otherwise.
  const { runMock } = await import("./mock-run.mjs");
  await runMock({
    spec,
    report,
    callInternal,
    updateTask,
    pollSteers,
    sleep,
    steerWaitMs: STEER_WAIT_MS,
  });
  process.exit(0);
} else {
  await runReal();
}
