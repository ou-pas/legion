// A session's SSE stream (`GET /api/sessions/:id/live`), held as a list of events.
//
// The task page and the channels view read EXACTLY the same stream for the same session. One hook
// is the only way to guarantee both see the same thing, with the type allowlist in one place. Until
// 28/08 the task page kept its own copy (65 lines, allowlist included): a type added on one side
// would have reached the browser and never shown on the other.
//
// The hook does NOT decide what an event becomes: the channel makes a conversation of it
// (`channels/transcript.ts`), the task page a trace.
import { useEffect, useRef, useState } from "react";

export type SessionEvent = {
  type: string;
  data: Record<string, unknown>;
  /** The database row id, carried by SSE (`Last-Event-ID`). Added on 26/08 so a task's thread can
   *  merge this stream with multi-session history without duplicates: both sources speak the same
   *  integer. `undefined` on an event without id (never in practice). */
  dbId?: number;
  /** The event's session. The SSE stream knows one; history spans several, and this field draws the
   *  break between them. */
  sessionId?: string;
};

/** STREAM state, distinct from session state: a thread that stopped moving because the stream
 *  dropped looks exactly like an idle session. This makes that silence visible. */
export type SessionStream = "live" | "retry" | "closed";

/** ALLOWLIST: a type absent here reaches the browser but is never displayed. Exported so the test
 *  walks it AS IS; a copy in the test would be a second list. */
export const SESSION_EVENT_TYPES = [
  "status",
  "init",
  "tool_start",
  "tool_end",
  "text",
  "activity",
  "task_status",
  "result",
  "run_error",
  "run_warning",
  "inbox_ask",
  "inbox_answer",
  "inbox_note",
  "fs_op",
  "fs_denied",
  "throttle",
  "repo_ready",
  "repo_push",
  "repo_push_failed",
  "capabilities",
  // Steering (v23): the line that makes the send visible.
  "steer",
  "steer_delivered",
  // wait_for_task (v26): the session sleeps on a dependency, then wakes by itself.
  "dependency_wait",
  "dependency_resolved",
] as const;

export function useSessionEvents(
  sessionId: string | undefined,
  onEvent?: (type: string) => void,
): {
  events: SessionEvent[];
  stream: SessionStream;
  reconnect: () => void;
} {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [stream, setStream] = useState<SessionStream>("live");
  const [retry, setRetry] = useState(0);
  // Reset DURING render on session change, not in an effect (cascading render, oxlint
  // react/set-state-in-effect).
  const [seen, setSeen] = useState(sessionId);
  // The callback goes through a ref: as an effect dependency it would open a new EventSource on
  // every caller render, and the server would replay the whole stream.
  const notify = useRef(onEvent);
  // Written in an EFFECT, not during render: touching `.current` in render reads a value that does
  // not belong to the render (oxlint react/refs).
  useEffect(() => {
    notify.current = onEvent;
  });
  if (sessionId !== seen) {
    setSeen(sessionId);
    setEvents([]);
  }

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/sessions/${sessionId}/live`);
    // Dedup by SSE id, which IS the row id: a cut while an event is written can deliver it twice.
    const ids = new Set<string>();
    const receive = (e: MessageEvent, type: string) => {
      if (e.lastEventId) {
        if (ids.has(e.lastEventId)) return;
        ids.add(e.lastEventId);
      }
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        /* unreadable payload: the line stays */
      }
      const dbId = e.lastEventId ? Number(e.lastEventId) : undefined;
      setEvents((prev) => [
        ...prev,
        {
          type,
          data,
          sessionId,
          ...(Number.isFinite(dbId) ? { dbId } : {}),
        },
      ]);
      notify.current?.(type);
    };
    for (const t of SESSION_EVENT_TYPES)
      es.addEventListener(t, (e) => receive(e as MessageEvent, t));
    // End announced by the server: we close OURSELVES, or the browser takes it for a cut and
    // reconnects every 3 s to a finished session.
    es.addEventListener("stream_end", () => {
      setStream("live");
      es.close();
    });
    es.onopen = () => setStream("live");
    // Do NOT close on error: EventSource reconnects by itself, sending `Last-Event-ID`.
    es.onerror = () => setStream(es.readyState === EventSource.CLOSED ? "closed" : "retry");
    return () => es.close();
  }, [sessionId, retry]);

  return {
    events,
    stream,
    reconnect: () => {
      setStream("retry");
      setRetry((n) => n + 1);
    },
  };
}
