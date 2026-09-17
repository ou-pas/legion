// End-to-end check against the REAL server.
//
//   LEGION_TOKEN=… pnpm smoke [project-slug]
//
// The executable form of "run a few tasks and check everything works": it makes the calls, waits
// for real transitions and returns a verdict. It cleans up: every task it creates carries the
// SMOKE prefix and is deleted at the end, even on failure.
import { SESSION_STATUS } from "../sessions/session-terminal.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
const BASE = process.env.LEGION_URL ?? "http://localhost:8790";
const SLUG = process.argv[2] ?? "legion";
const PREFIX = "SMOKE";

// `/api` requires an operator session since 13/09: without a token every call gets 401 and the
// first check blames a server that is actually running.
const TOKEN = process.env.LEGION_TOKEN;
if (!TOKEN) {
  console.error(
    "⛔ LEGION_TOKEN is missing: the API requires an operator session.\n" +
      "   Pass the token: `LEGION_TOKEN=… pnpm smoke`. It is shown once, when the control plane\n" +
      "   that created it starts; `make operator-token` sets a new one.",
  );
  process.exit(2);
}
const AUTH = { authorization: `Bearer ${TOKEN}` };

let pass = 0,
  fail = 0;
const created: string[] = [];

const ok = (label: string, detail = "") => {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
};
const ko = (label: string, detail = "") => {
  fail++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
};
const step = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...AUTH, ...init.headers },
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: body as T };
}

/** Returns the last value seen: a failure must say what was seen, not just "timeout". */
async function waitTask(taskId: string, pred: (t: any) => boolean, seconds = 60): Promise<any> {
  const until = Date.now() + seconds * 1000;
  let last: any = null;
  while (Date.now() < until) {
    const { body } = await api<{ tasks: any[]; sessions: any[] }>("/api/tasks");
    last = body.tasks.find((t) => t.id === taskId);
    const session = body.sessions.filter((s) => s.taskId === taskId).at(-1);
    if (last && pred({ ...last, session })) return { ...last, session };
    await sleep(1500);
  }
  return last ? { ...last, timedOut: true } : null;
}

/** Only what this script reads from `/api/bootstrap`; the rest stays untyped, this is not a client. */
interface SmokeProject {
  id: string;
  name: string;
  slug: string;
  demo: boolean;
  defaultModel: string;
}

/** 1. The base: the API answers, the project exists and can run something. Returns `null` for a
 *  demo project or one without agent or enabled runner: not a failure, nothing can run there. */
async function checkBoot(): Promise<{ project: SmokeProject; agentId: string } | null> {
  step("1. Base");
  const boot = await api<{ projects: any[]; agents: any[]; runners: any[] }>("/api/bootstrap");
  if (boot.status !== 200) {
    const hint = boot.status === 401 ? "is LEGION_TOKEN the right one?" : "is the server running?";
    ko("the API answers", `HTTP ${boot.status}: ${hint}`);
    return null;
  }
  ok("the API answers");
  const project = boot.body.projects.find((p) => p.slug === SLUG);
  if (!project) {
    ko(
      `project "${SLUG}" found`,
      `known projects: ${boot.body.projects.map((p) => p.slug).join(", ") || "none"}`,
    );
    return null;
  }
  ok(
    `project "${project.name}"`,
    project.demo ? "DEMO: nothing runs here" : `model ${project.defaultModel}`,
  );
  const agents = boot.body.agents.filter((a) => a.projectId === project.id);
  if (agents.length) ok(`${agents.length} agent(s)`, agents.map((a) => a.name).join(", "));
  else ko("at least one agent");
  const runners = boot.body.runners.filter((r) => r.enabled);
  if (runners.length)
    ok(
      `${runners.length} enabled runner(s)`,
      runners.map((r) => `${r.name}(${r.kind}, max ${r.maxConcurrentSessions})`).join(", "),
    );
  else ko("an enabled runner");
  if (!agents.length || !runners.length || project.demo) return null;
  return { project, agentId: agents[0].id };
}

/** 2. The Later column: note without committing. A task enters it outside the queue, leaves only
 *  by a human action, and returns to it when leaving the queue. */
async function checkLaterColumn(project: SmokeProject, agentId: string): Promise<void> {
  step("2. Later column");
  const later = await api<any>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      name: `${PREFIX} noted without running`,
      projectId: project.id,
      agentId,
      status: TASK_STATUS.later,
    }),
  });
  if (later.status !== 201) {
    ko("creation in `later`", `HTTP ${later.status}`);
    return;
  }
  created.push(later.body.id);
  if (later.body.status === TASK_STATUS.later && later.body.queued === false)
    ok("created in `later`, outside the queue");
  else ko("created in `later`", `status=${later.body.status} queued=${later.body.queued}`);
  // It must NEVER start on its own: neither the queue nor the scheduler.
  await sleep(6000);
  const still = await api<{ tasks: any[] }>("/api/tasks");
  const t = still.body.tasks.find((x) => x.id === later.body.id);
  if (t?.status === TASK_STATUS.later)
    ok("still in `later` after 6 s", "no automatic path took it");
  else ko("should have stayed in `later`", `status=${t?.status}`);
  await checkEngageAndPostpone(later.body.id);
}

/** Commit, then postpone: postponing leaves the queue, and skipping the commit is refused. */
async function checkEngageAndPostpone(taskId: string): Promise<void> {
  const eng = await api(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: TASK_STATUS.todo }),
  });
  if (eng.status === 200) ok("`later` → `todo` (commit)");
  else ko("commit", `HTTP ${eng.status}`);
  const back = await api(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: TASK_STATUS.later }),
  });
  const after = (await api<{ tasks: any[] }>("/api/tasks")).body.tasks.find((x) => x.id === taskId);
  if (back.status === 200 && after?.status === TASK_STATUS.later && after?.queued === false)
    ok("`todo` → `later` (postpone)", "and `queued` reset to false");
  else ko("postpone", `HTTP ${back.status} status=${after?.status} queued=${after?.queued}`);
  const bad = await api(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: TASK_STATUS.done }),
  });
  if (bad.status === 400) ok("`later` → `done` refused", "commit first");
  else ko("forbidden transition not refused", `HTTP ${bad.status}`);
}

/** Live events until `stream_end` or three minutes. The last id received is what lets the
 *  partial replay be checked next. */
async function collectLiveEvents(
  sid: string,
): Promise<{ seen: Map<string, number>; lastId: number }> {
  const seen = new Map<string, number>();
  let lastId = 0;
  const until = Date.now() + 180_000;
  let terminal = false;
  while (Date.now() < until && !terminal) {
    const res = await fetch(`${BASE}/api/sessions/${sid}/live`, {
      headers: lastId ? { ...AUTH, "last-event-id": String(lastId) } : AUTH,
    });
    const text = await res.text();
    for (const block of text.split("\n\n")) {
      const idLine = block.match(/^id:\s*(\d+)/m);
      const evLine = block.match(/^event:\s*(\S+)/m);
      if (idLine) lastId = Math.max(lastId, Number(idLine[1]));
      if (!evLine) continue;
      const type = evLine[1]!;
      seen.set(type, (seen.get(type) ?? 0) + 1);
      if (type === "stream_end") terminal = true;
    }
    if (!terminal) await sleep(2000);
  }
  return { seen, lastId };
}

/** Reconnected on a middle id, only what follows must arrive. */
async function checkPartialReplay(sid: string, lastId: number): Promise<void> {
  const mid = Math.max(1, lastId - 3);
  const again = await fetch(`${BASE}/api/sessions/${sid}/live`, {
    headers: { ...AUTH, "last-event-id": String(mid) },
  });
  const ids = [...(await again.text()).matchAll(/^id:\s*(\d+)/gm)].map((m) => Number(m[1]));
  if (ids.length > 0 && ids.every((i) => i > mid))
    ok("replay on `Last-Event-ID`", `${ids.length} event(s), all > ${mid}`);
  else ko("partial replay", `received ${ids.length} event(s): ${ids.slice(0, 5).join(", ")}`);
}

/** The session stopped on a question: answer it and check it resumes. `impact` and `evidence` let
 *  the operator decide without opening the session, so their absence is a failure. */
async function answerPendingQuestion(taskId: string): Promise<void> {
  const inbox = await api<any[]>("/api/inbox");
  const q = inbox.body.find((i) => i.taskId === taskId);
  if (!q) {
    ko("question not found in the inbox");
    return;
  }
  if (q.impact) ok("impact radius provided", String(q.impact).slice(0, 60));
  else ko("impact radius missing", "the agent did not fill `impact`");
  if (q.evidence) ok("evidence excerpt provided", `${String(q.evidence).length} chars`);
  else ko("evidence excerpt missing", "the agent did not fill `evidence`");
  const rep = await api(`/api/inbox/${q.id}/reply`, {
    method: "POST",
    body: JSON.stringify({ text: "continue" }),
  });
  if (rep.status === 200) ok("answer sent");
  else ko("answer", `HTTP ${rep.status}`);
  const resumed = await waitTask(taskId, (t) => (t.session?.resumeCount ?? 0) > 0, 120);
  if ((resumed?.session?.resumeCount ?? 0) > 0)
    ok(
      "session resumed",
      `resumeCount=${resumed.session.resumeCount}, status ${resumed.session.status}`,
    );
  else ko("resume after answer", `session ${resumed?.session?.status}`);
}

/** Where did it land? An ended session is nominal; a waiting one leads to the question and its
 *  resume; a failure points to the trace. */
async function checkWhereItLanded(taskId: string): Promise<void> {
  const end = await waitTask(
    taskId,
    (t) =>
      [TASK_STATUS.review, TASK_STATUS.done].includes(t.status) ||
      ["destroyed", "failed", SESSION_STATUS.waiting].includes(t.session?.status ?? ""),
    30,
  );
  const st = end?.session?.status ?? "?";
  if (st === "destroyed") {
    ok("session ended cleanly", `task: ${end.status}`);
    return;
  }
  if (st === SESSION_STATUS.waiting) {
    ok("session paused on a question", "answering, then checking the resume");
    await answerPendingQuestion(taskId);
    return;
  }
  if (st === "failed")
    ko("session failed", "check the task's trace: often the image or a missing secret");
  else ko("session in an unexpected state", st);
}

/** 3. A real launch. The first `init` proves the container fetched its spec over HTTP with its
 *  nonce; the spec no longer travels in its environment. */
async function checkRealSession(project: SmokeProject, agentId: string): Promise<void> {
  step("3. Real session");
  console.log(
    "   (the first `init` received proves the container fetched its spec\n" +
      "    over HTTP with its nonce: it no longer travels in its environment)",
  );
  const run = await api<any>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      name: `${PREFIX} say hello`,
      projectId: project.id,
      agentId,
      description:
        'Just answer "hello", then mark the task done. Do not write any file, do not clone anything.',
    }),
  });
  if (run.status !== 201) {
    ko("task creation", `HTTP ${run.status}`);
    return;
  }
  created.push(run.body.id);
  ok("task created", run.body.id);
  const launched = await api<any>(`/api/tasks/${run.body.id}/run`, { method: "POST" });
  if (launched.status !== 202) {
    ko("launch", `HTTP ${launched.status} ${JSON.stringify(launched.body)}`);
    return;
  }
  if (launched.body.queued) {
    ko("launch", "queued: capacity is full, run again when a runner is free");
    return;
  }
  ok("session started", launched.body.sessionId);
  const sid = launched.body.sessionId as string;

  const { seen, lastId } = await collectLiveEvents(sid);
  if (seen.has("init")) ok("`init` event received", "→ the spec was fetched over HTTP");
  else
    ko(
      "no `init`",
      "the container could not fetch its spec: image rebuilt? (`make image-session`)",
    );
  if (seen.has("stream_end")) ok("end of stream announced", "no reconnect loop");
  else ko("`stream_end` missing", "the browser would reconnect every 3 s");
  console.log(`     events: ${[...seen.entries()].map(([k, v]) => `${k}×${v}`).join(", ")}`);

  await checkPartialReplay(sid, lastId);
  await checkWhereItLanded(run.body.id);
}

/** 4. Cleanup: deleting what this script created is itself a check. */
async function cleanUpCreated(): Promise<void> {
  step("4. Cleanup");
  for (const id of created) {
    const res = await api<any>(`/api/tasks/${id}`, { method: "DELETE" });
    if (res.status === 200)
      ok("task deleted", `${res.body.deleted} (${JSON.stringify(res.body.footprint)})`);
    else ko("deletion", `HTTP ${res.status} ${res.body?.error ?? ""}`);
  }
}

async function main() {
  console.log(`\x1b[1mLegion — end-to-end check\x1b[0m\n${BASE} · project "${SLUG}"`);
  const base = await checkBoot();
  if (!base) return;
  await checkLaterColumn(base.project, base.agentId);
  await checkRealSession(base.project, base.agentId);
  await cleanUpCreated();
}

main()
  .catch((e) => {
    ko("unexpected error", (e as Error).message);
  })
  .finally(async () => {
    // Safety net: if `main` returned before cleanup, clean up anyway.
    const rest =
      (await api<{ tasks: any[] }>("/api/tasks")).body.tasks?.filter((t) =>
        t.name?.startsWith(PREFIX),
      ) ?? [];
    for (const t of rest) await api(`/api/tasks/${t.id}`, { method: "DELETE" });
    console.log(
      `\n${fail === 0 ? "\x1b[32m✅" : "\x1b[31m❌"} ${pass} check(s) passed, ${fail} failure(s)\x1b[0m`,
    );
    if (rest.length) console.log(`   (${rest.length} SMOKE task(s) cleaned up on exit)`);
    process.exit(fail === 0 ? 0 : 1);
  });
