// Sessions domain routes: analytics, terminal resume, stop/steer/reap, SSE stream.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { replay, subscribe, type SessionEvent } from "../shared/events.js";
import { reapDeadSessions, stopSession } from "../sessions/runner/manager.js";
import { enqueueSteer, normalizeSteerText, steerRefusal } from "../sessions/steering.js";
import { requestPause } from "../sessions/operator-pause.js";
import { listTaskEvents } from "../sessions/task-events.js";
import { resumeCommandFor } from "../sessions/resume-command.js";
import { z } from "zod";
import { crossOriginBlocked } from "../http/guard.js";
import { parseBody } from "../http/parse-body.js";

/** `text` arrives RAW: `normalizeSteerText` trims it, refuses emptiness, truncates at the ceiling
 *  and returns `truncated`. The schema only states the shape. */
const steerBody = z.strictObject({ text: z.string() });

// Two notes on the routes below, kept here so the function does not grow (06/09):
//
//  · `crossOriginBlocked` calls are gone from the POSTs: `mutationOriginGuard` already covers every
//    mutating verb outside `/internal` and `/webhooks`. The one on `resume-command` stays, alone,
//    because it is a GET and the middleware does not look at reads;
//  · `stop`'s `catch` stays: `stopSession` refuses by throwing a bare `Error` (session not found,
//    already over), and letting it reach `app.onError` would make it an anonymous 500.

export function registerSessionRoutes(app: Hono): void {
  // Per agent / model analytics (lot 3).
  app.get("/api/analytics", (c) => {
    const sessions = db.select().from(schema.sessions).all();
    const agents = new Map(
      db
        .select()
        .from(schema.agents)
        .all()
        .map((a) => [a.id, a.name]),
    );
    const byKey = new Map<
      string,
      {
        agent: string;
        model: string;
        runs: number;
        failed: number;
        costUsd: number;
        durationMs: number;
        ended: number;
      }
    >();
    for (const s of sessions) {
      const key = `${s.agentId}|${s.model}`;
      const row = byKey.get(key) ?? {
        agent: agents.get(s.agentId) ?? "?",
        model: s.model,
        runs: 0,
        failed: 0,
        costUsd: 0,
        durationMs: 0,
        ended: 0,
      };
      row.runs++;
      if (s.status === "failed") row.failed++;
      row.costUsd += s.costUsd ?? 0;
      // Average duration over FINISHED sessions only (review lot3 #7), otherwise diluted by live ones.
      if (s.endedAt) {
        row.durationMs += s.endedAt.getTime() - s.startedAt.getTime();
        row.ended++;
      }
      byKey.set(key, row);
    }
    const rows = [...byKey.values()]
      .map((r) => ({
        agent: r.agent,
        model: r.model,
        runs: r.runs,
        failed: r.failed,
        costUsd: Number(r.costUsd.toFixed(4)),
        avgDurationMs: r.ended ? Math.round(r.durationMs / r.ended) : 0,
        failRate: r.runs ? Number((r.failed / r.runs).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);
    return c.json(rows);
  });

  // Terminal takeover (v11): the claude --resume command ready to paste.
  // ASYNC since slice 06: for a session that ran on an `ssh://` runner, the Claude state is in a
  // volume on the OTHER machine and must be brought back before the command means anything. The
  // whole decision is in `resume-command.ts`, including the written refusal when the machine sleeps
  // or the volume was swept.
  //
  // Hence an origin guard on a GET. The `http/app.ts` middleware only covers mutating verbs, because
  // a GET mutated nothing. This one stopped being so: it writes to the control plane's disk and
  // creates a container on a remote machine. It stops a cross-origin `fetch()`; it does not stop an
  // `<img>` tag, which sends no `Origin`. What remains in front: the session id is a nanoid, and
  // without it the route answers 404 before touching anything.
  app.get("/api/sessions/:id/resume-command", async (c) => {
    if (crossOriginBlocked(c)) return c.json({ error: "origin not allowed" }, 403);
    const r = await resumeCommandFor(c.req.param("id"));
    return r.ok
      ? c.json({ command: r.command, note: r.note })
      : c.json({ error: r.error }, r.status);
  });

  app.post("/api/sessions/reap", async (c) => c.json({ reaped: await reapDeadSessions() }));

  app.post("/api/sessions/:id/stop", async (c) => {
    try {
      await stopSession(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String((err as Error).message) }, 400);
    }
  });

  // REQUESTED pause (26/08): the human counterpart of an inbox pause. `stop` cuts dead; this one
  // asks, and the agent stops at the end of its turn after pushing its work. The refusal during
  // `committing` is the only one that really protects something; see operator-pause.ts.
  app.post("/api/sessions/:id/pause", (c) => {
    const refusal = requestPause(c.req.param("id"));
    if (refusal) return c.json({ error: refusal.error }, refusal.status);
    return c.json({ ok: true });
  });

  // Steering (v23): telling a RUNNING agent something without stopping it. The inverse of the inbox:
  // the human pushes, and the session does not pause. The message is queued (sessions/steering.ts);
  // the runtime fetches it on its callback channel. NAMED refusal outside `running`: a paused session
  // already has its channel (its question), a finished one no longer listens, and both would swallow
  // the message silently.
  app.post("/api/sessions/:id/steer", async (c) => {
    const sessionId = c.req.param("id");
    const session = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    const refusal = steerRefusal(session?.status);
    if (refusal) return c.json({ error: refusal.error }, refusal.status);
    const body = await parseBody(c, steerBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const parsed = normalizeSteerText(body.value.text);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const steer = enqueueSteer(sessionId, parsed.text);
    return c.json(
      { ok: true, steerId: steer.id, text: parsed.text, truncated: parsed.truncated },
      201,
    );
  });

  // A task's full thread across sessions (Channels): the history in one read, `sessionId` on each
  // event so the UI draws the break between two sessions. The PRESENT stays on
  // `/api/sessions/:id/live` (SSE, live session only); see task-events.ts's header for the past/present
  // split.
  app.get("/api/tasks/:id/events", (c) => {
    const taskId = c.req.param("id");
    if (!db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get())
      return c.json({ error: "task not found" }, 404);
    const since = Number.parseInt(c.req.query("since") ?? "", 10);
    const page = listTaskEvents(taskId, Number.isFinite(since) && since > 0 ? since : 0);
    return c.json(page);
  });

  // Live session stream: subscribe FIRST (buffering), replay from DB, then follow with
  // dedupe on the DB row id — no event can be lost in the replay/subscribe gap (review #3).
  const isTerminal = (ev: SessionEvent) =>
    ev.type === "status" &&
    ["destroyed", "failed"].includes((ev.payload as { status?: string }).status ?? "");

  /** A session whose ROW is terminal: a stream reconnected after the end must not wait forever for an
   *  event that will not come. On a partial resume (`Last-Event-ID`) the terminal event has often
   *  already been delivered, so scanning the replayed events is not enough. */
  const sessionFinished = (sessionId: string) => {
    const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
    return row !== undefined && ["destroyed", "failed"].includes(row.status);
  };

  app.get("/api/sessions/:id/live", (c) =>
    streamSSE(c, async (stream) => {
      const sessionId = c.req.param("id");
      let done = false;
      const queue: SessionEvent[] = [];
      let wake: (() => void) | null = null;
      const unsub = subscribe(sessionId, (ev) => {
        queue.push(ev);
        wake?.();
      });
      stream.onAbort(() => {
        done = true;
        unsub();
        wake?.();
      });

      const send = (ev: SessionEvent) =>
        stream.writeSSE({
          id: String(ev.dbId),
          event: ev.type,
          data: JSON.stringify({ ...(ev.payload as object), ts: ev.ts }),
        });

      // DELIBERATE END. SSE does not distinguish "the server finished" from "the connection
      // dropped": either way the browser sees a close and reconnects after three seconds. On a
      // finished session that meant a reconnect every 3 s forever, and, since the stream state is
      // displayed, a flashing disconnection alert on a perfectly finished session. An explicit end
      // event lets the client close itself, without retrying.
      const end = () => stream.writeSSE({ event: "stream_end", data: "{}" });

      try {
        // Resume after a cut: the browser sends back the last received event id. We restart from
        // there instead of resending the whole trace, so a Mac sleeping or a server restart only
        // costs a delta.
        const resumeFrom = Number.parseInt(c.req.header("last-event-id") ?? "", 10);
        let lastSent = Number.isFinite(resumeFrom) && resumeFrom > 0 ? resumeFrom : 0;
        let sawTerminal = false;
        for (const ev of replay(sessionId, lastSent)) {
          await send(ev);
          lastSent = ev.dbId;
          if (isTerminal(ev)) sawTerminal = true;
        }
        // Finished session at connect time → close instead of hanging forever (review #2).
        // `sessionFinished` covers a resume where the terminal event was already delivered: without
        // it the stream stayed open forever on a dead session.
        if (sawTerminal || sessionFinished(sessionId)) {
          await end();
          return;
        }

        while (!done) {
          while (queue.length) {
            const ev = queue.shift()!;
            if (ev.dbId <= lastSent) continue; // duplicate of a replayed event
            await send(ev);
            lastSent = ev.dbId;
            if (isTerminal(ev)) done = true;
          }
          if (!done) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
          }
        }
        // Exit through a terminal event (not a client abort): announce the end.
        if (done) await end().catch(() => {});
      } finally {
        unsub();
      }
    }),
  );
}
