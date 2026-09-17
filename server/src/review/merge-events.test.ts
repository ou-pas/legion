// The webhooks batch, checked on both levels.
//
//  · `handleForgeEvent`, the decision: the payload identifies, the forge (injected here) confirms,
//    and only confirmation moves anything. The "doorbell, never a source of truth".
//  · the routes, the door: HMAC signature/token on the raw body, size cap, 200 on ignored events,
//    replayable 503 when the forge is unreadable.
//
// LEGION_GITHUB_FAKE=1: the fake mode deliberately cannot say "merged" (no `prState` in its
// answers), so it can never confirm a merge. That makes the 503 test ("unreadable → replayable")
// possible offline, and it is a safety property not to "fix".
//
// Each test uses its own PR URL: matching is by URL, and a shared URL would match an earlier
// test's tasks.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { TaskStatus } from "../tasks/lifecycle.js";
import type { PrState } from "../integrations/forge.js";

const dir = mkdtempSync(join(tmpdir(), "legion-merge-events-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_GITHUB_FAKE = "1";
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { handleForgeEvent } = await import("./merge-events.js");
const { registerInboundWebhookRoutes } = await import("./inbound-webhook-routes.js");
const { inboundWebhookSecret } = await import("../integrations/inbound-webhooks.js");
const { completeTask } = await import("../tasks/complete.js");
const { githubForge } = await import("../integrations/github.js");
const { gitlabForge } = await import("../integrations/gitlab.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { REVIEW_COMMENT_STATUS } = await import("./review-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerInboundWebhookRoutes(app);

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P", slug: "p", createdAt: now }).run();
db.insert(schema.agents)
  .values({
    id: "a1",
    projectId: "p1",
    name: "agent",
    rolePrompt: "r",
    inboxAccess: true,
    createdAt: now,
  })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.process }).run();

let seq = 0;
function seedTask(prUrls: string[], status: TaskStatus = TASK_STATUS.review): string {
  const id = `t${++seq}`;
  db.insert(schema.tasks)
    .values({
      id,
      projectId: "p1",
      name: `task ${id}`,
      description: "",
      status,
      prUrls: JSON.stringify(prUrls.map((url, i) => ({ repo: `repo${i}`, url }))),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/** The session that produced the review, which the webhook trace must attach to. */
function seedSession(
  taskId: string,
  status: typeof schema.sessions.$inferInsert.status = "destroyed",
): string {
  const id = `s-${taskId}`;
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status,
      callbackToken: `tok-${id}`,
      mock: true,
      startedAt: now,
    })
    .run();
  return id;
}

function taskStatus(id: string): string {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!.status;
}

/** A fake `mergeStatesOf`: the same `prState` for every PR (absent = unreadable forge). */
const forgeSays =
  (prState?: PrState) => async (_pid: string, prs: readonly { repo: string; url: string }[]) =>
    prs.map((p) => ({
      ...p,
      number: 1,
      mergeState: "unknown" as const,
      ...(prState ? { prState } : {}),
    }));

const realDeps = (prState?: PrState) => ({
  mergeStates: forgeSays(prState),
  complete: completeTask,
});

describe("handleForgeEvent: the payload identifies, the forge decides", () => {
  it("all PRs merged → done, and blocked tasks are released", async () => {
    const url = "https://github.com/o/front/pull/1";
    const t = seedTask([url]);
    const blocked = seedTask([], TASK_STATUS.later);
    db.insert(schema.taskBlockers).values({ taskId: blocked, blockerId: t, createdAt: now }).run();

    const out = await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    assert.deepEqual(out, { matched: 1, completed: [t], unreadable: false });
    assert.equal(taskStatus(t), TASK_STATUS.done);
    // The blocker link is consumed in the same transaction as the done.
    assert.equal(
      db
        .select()
        .from(schema.taskBlockers)
        .all()
        .filter((b) => b.blockerId === t).length,
      0,
    );
  });

  it("the forge says open: the signed merged payload is not enough", async () => {
    const url = "https://github.com/o/front/pull/2";
    const t = seedTask([url]);
    const out = await handleForgeEvent(
      { kind: "merged", url },
      realDeps(REVIEW_COMMENT_STATUS.open),
    );
    assert.equal(out.completed.length, 0);
    assert.equal(taskStatus(t), TASK_STATUS.review);
  });

  it("task with two PRs: the first merge moves nothing, the second finishes", async () => {
    const urlA = "https://github.com/o/front/pull/3";
    const urlB = "https://framagit.org/o/api/-/merge_requests/3";
    const t = seedTask([urlA, urlB]);
    // First ring: the forge says B is still open.
    const half = async (_pid: string, prs: readonly { repo: string; url: string }[]) =>
      prs.map((p) => ({
        ...p,
        number: 1,
        mergeState: "unknown" as const,
        prState: (p.url === urlA ? "merged" : REVIEW_COMMENT_STATUS.open) as PrState,
      }));
    await handleForgeEvent(
      { kind: "merged", url: urlA },
      { mergeStates: half, complete: completeTask },
    );
    assert.equal(taskStatus(t), TASK_STATUS.review);
    // Second ring: everything is merged.
    const out = await handleForgeEvent({ kind: "merged", url: urlB }, realDeps("merged"));
    assert.ok(out.completed.includes(t));
    assert.equal(taskStatus(t), TASK_STATUS.done);
  });

  it("closed without merge: nothing moves, but the task says so (system activity)", async () => {
    const url = "https://github.com/o/front/pull/4";
    const t = seedTask([url]);
    const out = await handleForgeEvent({ kind: "closed", url }, realDeps("merged"));
    assert.deepEqual(out.completed, []);
    assert.equal(taskStatus(t), TASK_STATUS.review);
    const notes = db
      .select()
      .from(schema.taskActivity)
      .all()
      .filter((a) => a.taskId === t);
    assert.equal(notes.length, 1);
    assert.match(notes[0]!.body, /closed without being merged/);
  });

  it("replay after done: the task is no longer a candidate, no-op", async () => {
    const url = "https://github.com/o/front/pull/5";
    seedTask([url]);
    await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    const replay = await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    assert.equal(replay.matched, 0);
  });

  it("re-read without a verdict (prState absent): nothing moves, and it is flagged replayable", async () => {
    const url = "https://github.com/o/front/pull/6";
    const t = seedTask([url]);
    const out = await handleForgeEvent({ kind: "merged", url }, realDeps(undefined));
    assert.equal(out.unreadable, true);
    assert.equal(taskStatus(t), TASK_STATUS.review);
  });
});

/** `webhooks` events traced for this task, oldest first: the trace added by the 03/09 batch
 *  (partial merge as info, unreadable as warn). */
function webhookEventsFor(
  taskId: string,
): { level: string; message: string; payload: Record<string, unknown> }[] {
  return db
    .select()
    .from(schema.controlEvents)
    .where(eq(schema.controlEvents.source, "webhooks"))
    .all()
    .filter((r) => {
      if (!r.payload) return false;
      try {
        return (JSON.parse(r.payload) as Record<string, unknown>).taskId === taskId;
      } catch {
        return false;
      }
    })
    .map((r) => ({
      level: r.level,
      message: r.message,
      payload: JSON.parse(r.payload!) as Record<string, unknown>,
    }))
    .reverse();
}

describe("the partial merge trace (03/09): the webhook no longer keeps quiet", () => {
  it("partial merge: an info naming the waiting repository", async () => {
    const urlA = "https://github.com/o/front/pull/20";
    const urlB = "https://framagit.org/o/api/-/merge_requests/20";
    const t = seedTask([urlA, urlB]);
    const half = async (_pid: string, prs: readonly { repo: string; url: string }[]) =>
      prs.map((p) => ({
        ...p,
        number: 1,
        mergeState: "unknown" as const,
        prState: (p.url === urlA ? "merged" : REVIEW_COMMENT_STATUS.open) as PrState,
      }));
    await handleForgeEvent(
      { kind: "merged", url: urlA },
      { mergeStates: half, complete: completeTask },
    );
    assert.equal(taskStatus(t), TASK_STATUS.review);

    const events = webhookEventsFor(t).filter((e) => e.payload.kind === "merge-partial");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.level, "info");
    assert.match(events[0]!.message, /repo1/); // urlB is prUrls[1] → repo "repo1"
    assert.deepEqual(events[0]!.payload.waiting, ["repo1"]);
    assert.equal(events[0]!.payload.mergedCount, 1);
    assert.equal(events[0]!.payload.total, 2);
  });

  it("unreadable state: a warn, not an info, since it is an anomaly", async () => {
    const url = "https://github.com/o/front/pull/21";
    const t = seedTask([url]);
    await handleForgeEvent({ kind: "merged", url }, realDeps(undefined));

    const events = webhookEventsFor(t).filter((e) => e.payload.kind === "merge-unreadable");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.level, "warn");
    assert.deepEqual(events[0]!.payload.repos, ["repo0"]);
  });

  it("two successive webhooks with no count change write once", async () => {
    const urlA = "https://github.com/o/front/pull/22";
    const urlB = "https://framagit.org/o/api/-/merge_requests/22";
    const t = seedTask([urlA, urlB]);
    const half = async (_pid: string, prs: readonly { repo: string; url: string }[]) =>
      prs.map((p) => ({
        ...p,
        number: 1,
        mergeState: "unknown" as const,
        prState: (p.url === urlA ? "merged" : REVIEW_COMMENT_STATUS.open) as PrState,
      }));
    const deps = { mergeStates: half, complete: completeTask };
    // First ring: A merged. Second: a comment or update on B re-reading the same state (A merged,
    // B still open), so the count did not move.
    await handleForgeEvent({ kind: "merged", url: urlA }, deps);
    await handleForgeEvent({ kind: "merged", url: urlB }, deps);

    const events = webhookEventsFor(t).filter((e) => e.payload.kind === "merge-partial");
    assert.equal(events.length, 1);
  });

  it("task with a single request, merged: it finishes, no waiting trace", async () => {
    const url = "https://github.com/o/front/pull/23";
    const t = seedTask([url]);
    const out = await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    assert.ok(out.completed.includes(t));
    assert.equal(taskStatus(t), TASK_STATUS.done);

    const events = webhookEventsFor(t).filter(
      (e) => e.payload.kind === "merge-partial" || e.payload.kind === "merge-unreadable",
    );
    assert.equal(events.length, 0);
  });
});

describe("the trace of a task closed by webhook (operator request, 03/09)", () => {
  it("the webhook's done leaves a task_status on the task's last session", async () => {
    const url = "https://github.com/o/front/pull/30";
    const t = seedTask([url]);
    const s = seedSession(t);

    const out = await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    assert.ok(out.completed.includes(t));

    const rows = db
      .select()
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, s))
      .all();
    const traced = rows
      .filter((r) => r.type === "task_status")
      .map((r) => JSON.parse(r.payload) as Record<string, unknown>);
    assert.equal(traced.length, 1);
    assert.deepEqual(traced[0], { status: TASK_STATUS.done, via: "webhook", url });
  });

  it("task without any session: the webhook's done does not fail for lack of a trace to attach to", async () => {
    const url = "https://github.com/o/front/pull/31";
    const t = seedTask([url]);
    const out = await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    assert.ok(out.completed.includes(t));
    assert.equal(taskStatus(t), TASK_STATUS.done);
  });
});

// 10/09, batch 7: session started at 15:05, its PR squashed onto `main` at 15:14. Squash-merge cuts
// the branch from its history (the session's commits are no longer ancestors) and the session keeps
// pushing to it. Its next PR carried 113 diff files for a batch touching 22. Nobody did anything
// wrong: merging is normal, it was just invisible from the session. We do not block it (a webhook
// is not a lock), we say it, in the trace the operator will read and in the control log.
describe("merging while a session runs", () => {
  it("writes a run_warning on the live session, and a log line", async () => {
    const url = "https://github.com/o/front/pull/40";
    const t = seedTask([url]);
    const s = seedSession(t, "running");

    await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));

    const warnings = db
      .select()
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, s))
      .all()
      .filter((r) => r.type === "run_warning")
      .map((r) => (JSON.parse(r.payload) as { message: string }).message);
    assert.equal(warnings.length, 1, "the live session is warned once");
    assert.match(warnings[0]!, /squashed onto main/);
    assert.match(warnings[0]!, /NEW branch/);
  });

  it("a replayed webhook does not stack the warning", async () => {
    const url = "https://github.com/o/front/pull/41";
    const t = seedTask([url]);
    const s = seedSession(t, "running");

    await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));
    await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));

    const count = db
      .select()
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, s))
      .all()
      .filter((r) => r.type === "run_warning").length;
    assert.equal(count, 1);
  });

  it("no live session: silence, the normal case", async () => {
    const url = "https://github.com/o/front/pull/42";
    const t = seedTask([url]);
    const s = seedSession(t);

    await handleForgeEvent({ kind: "merged", url }, realDeps("merged"));

    const warnings = db
      .select()
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, s))
      .all()
      .filter((r) => r.type === "run_warning");
    assert.equal(warnings.length, 0);
  });
});

describe("completeTask: the transition's guards", () => {
  it("refuses a later task (illegal transition) and admits a replay on done", () => {
    const tl = seedTask([], TASK_STATUS.later);
    assert.equal(completeTask(tl).ok, false);
    const td = seedTask([]);
    assert.equal(completeTask(td).ok, true);
    const r2 = completeTask(td);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.alreadyDone, true);
  });
});

describe("the routes: the door is a signature", () => {
  const secret = inboundWebhookSecret();
  const githubHeaders = (body: string, sig?: string) => ({
    "content-type": "application/json",
    "x-github-event": "pull_request",
    "x-hub-signature-256":
      sig ?? "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
  });
  const mergedBody = (url: string) =>
    JSON.stringify({ action: "closed", pull_request: { merged: true, html_url: url } });

  it("wrong or missing signature → 401, nothing moves", async () => {
    const body = mergedBody("https://github.com/o/front/pull/7");
    const bad = await app.request("/webhooks/github", {
      method: "POST",
      headers: githubHeaders(body, "sha256=deadbeef"),
      body,
    });
    assert.equal(bad.status, 401);
    const none = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(none.status, 401);
  });

  it("body over the cap → 413 before any read", async () => {
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "content-length": String(600 * 1024) },
      body: "x",
    });
    assert.equal(res.status, 413);
  });

  it("GitHub's ping (unknown event) → 200 ignored", async () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: { ...githubHeaders(body), "x-github-event": "ping" },
      body,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, ignored: true });
  });

  it("signed GitLab event on a URL nobody follows → 200, matched 0", async () => {
    const body = JSON.stringify({
      object_attributes: { action: "merge", url: "https://framagit.org/o/x/-/merge_requests/999" },
    });
    const res = await app.request("/webhooks/gitlab", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Merge Request Hook",
        "x-gitlab-token": secret,
      },
      body,
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { matched: number };
    assert.equal(json.matched, 0);
  });

  it("signed and matched, but re-read without a verdict → replayable 503; readable unmerged verdict → 200 fail-closed", async () => {
    // Without a verdict: the PR number is unreadable, `mergeStatesOf` degrades without `prState`.
    // Nothing is decided, the forge must be able to redeliver (GitLab retries on its own, GitHub
    // keeps its Redeliver button).
    const blind = "https://github.com/o/front/pull/not-a-number";
    const t1 = seedTask([blind]);
    const b1 = mergedBody(blind);
    const r1 = await app.request("/webhooks/github", {
      method: "POST",
      headers: githubHeaders(b1),
      body: b1,
    });
    assert.equal(r1.status, 503);
    assert.equal(taskStatus(t1), TASK_STATUS.review);
    // Readable verdict but not merged (the fake answers open, never merged, a safety property of
    // demo mode): nothing moves, and it is a 200 since the delivery was handled.
    const readable = "https://github.com/o/front/pull/8";
    const t2 = seedTask([readable]);
    const b2 = mergedBody(readable);
    const r2 = await app.request("/webhooks/github", {
      method: "POST",
      headers: githubHeaders(b2),
      body: b2,
    });
    assert.equal(r2.status, 200);
    assert.equal(taskStatus(t2), TASK_STATUS.review);
  });

  it("PATCH /api/inbound-webhooks validates the URL, GET returns the state without ever the secret", async () => {
    const bad = await app.request("/api/inbound-webhooks", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://cleartext.example" }),
    });
    assert.equal(bad.status, 400);
    const ok = await app.request("/api/inbound-webhooks", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://mini.tail.ts.net/" }),
    });
    assert.equal(ok.status, 200);
    const got = (await (await app.request("/api/inbound-webhooks")).json()) as Record<
      string,
      unknown
    >;
    assert.equal(got.baseUrl, "https://mini.tail.ts.net");
    assert.equal(got.secretReady, true);
    assert.equal(JSON.stringify(got).includes(secret), false);
  });
});

describe("createRepoHook: the fake does not touch the network", () => {
  const repo = { name: "front", url: "https://github.com/o/front.git", forge: "github" as const };
  it("both adapters return a fake hook under LEGION_GITHUB_FAKE", async () => {
    assert.deepEqual(
      await githubForge.createRepoHook("tok", repo, {
        url: "https://x/webhooks/github",
        secret: "s",
      }),
      { ok: true, id: "hook-fake-1", existing: false },
    );
    assert.deepEqual(
      await gitlabForge.createRepoHook(
        "tok",
        { ...repo, forge: "gitlab" },
        { url: "https://x/webhooks/gitlab", secret: "s" },
      ),
      { ok: true, id: "hook-fake-1", existing: false },
    );
  });
});
