// `GET /api/events`: the global SSE stream the screen listens to instead of polling.
//
// SSE, not WebSocket, as everywhere in the project. The skeleton is that of
// `/api/sessions/:id/live` (subscribe before writing, a buffer queue, a promise wake-up) with three
// differences:
//
//  1. No replay. This stream only carries staleness signals; replaying "the task changed" from an
//     hour ago says nothing more than refetching once. So no `Last-Event-ID`, no `id:` lines, and
//     the screen invalidates everything on reconnect, which is safer than a cursor we would trust.
//  2. No end. A session ends, the control plane does not: the only exit is the client leaving.
//  3. A heartbeat every 25 s. Intermediaries (Vite's proxy, the tailnet tunnel) silently drop idle
//     connections. The SSE comment `: ping` triggers no event in the browser; it only holds the line.
//
// No guard of its own: this is an `/api` route like the others, behind the `operatorGuard` mounted
// on `*` in `http/app.ts`.
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeControl, type ControlEvent } from "./control-stream.js";

/** Under the one-minute idle cut of most intermediaries, and rare enough to cost nothing.
 *  Configurable at registration so the test does not wait. */
export const HEARTBEAT_MS = 25_000;

export function registerEventRoutes(app: Hono, opts: { heartbeatMs?: number } = {}): void {
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      let done = false;
      const queue: ControlEvent[] = [];
      /** Reset to `null` as soon as it fires: `subscribeControl` and `onAbort` can fire together. */
      let wake: (() => void) | null = null;
      const unsubscribe = subscribeControl((ev) => {
        queue.push(ev);
        wake?.();
      });
      stream.onAbort(() => {
        done = true;
        unsubscribe();
        wake?.();
      });

      // Type and ids only: the screen refetches the route it knows, which stays the one truth.
      const send = (ev: ControlEvent) =>
        stream.writeSSE({
          data: JSON.stringify({
            type: ev.type,
            sessionId: ev.sessionId,
            taskId: ev.taskId,
            projectId: ev.projectId,
            ts: ev.ts,
          }),
        });
      const beat = () => stream.write(": ping\n\n");

      try {
        // Beat immediately: it pushes the headers through intermediaries' buffers, so the browser
        // goes `open` without waiting for a first event that may never come on an idle plane.
        await beat();
        while (!done) {
          while (queue.length) {
            const ev = queue.shift()!;
            await send(ev);
          }
          if (done) break;
          const woken = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              wake = null;
              resolve(false);
            }, heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              wake = null;
              resolve(true);
            };
          });
          if (!woken && !done) await beat();
        }
      } finally {
        unsubscribe();
      }
    }),
  );
}
