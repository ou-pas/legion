// A whole task's thread: frozen history plus the live session's stream.
//
// `useSessionEvents` listens to ONE session. A task relaunched after failure, resumed after an inbox
// pause or restarted on a diagnostic has several: the screen showed only the last, while the
// question explaining the stop belonged to the previous one. The fixing route
// (`GET /api/tasks/:id/events`, PR #43) shipped a month earlier with no caller; `make contract`
// named it on 26/08.
//
// The past is frozen and only the present needs a stream: history is read in one request, live goes
// through the live session's SSE (`Last-Event-ID` resume, `stream_end`). No second SSE stream.
//
// Merging uses `dbId`, the `session_events` primary key. GLOBAL across sessions, it is both identity
// (dedup) and order (exact chronology), which makes the overlap harmless: SSE replays its session
// from the start, and history already holds it.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { taskHistoryApi, type TaskEventSession } from "../api/task-history.js";
import { useSessionEvents, type SessionEvent, type SessionStream } from "./use-session-events.js";

export type { TaskEventSession };

export function taskEventsKey(taskId: string) {
  return ["task-events", taskId] as const;
}

export function useTaskEvents(
  taskId: string | undefined,
  liveSessionId: string | undefined,
  onEvent?: (type: string) => void,
): {
  events: SessionEvent[];
  sessions: TaskEventSession[];
  stream: SessionStream;
  reconnect: () => void;
} {
  const history = useQuery({
    queryKey: taskEventsKey(taskId ?? ""),
    queryFn: () => taskHistoryApi.events(taskId!),
    enabled: Boolean(taskId),
    // History only moves through the live session, whose stream we receive. Refetching adds nothing
    // while the page is open; it adds everything on return.
    staleTime: 30_000,
  });

  const live = useSessionEvents(liveSessionId, onEvent);

  const events = useMemo(() => {
    const past = (history.data?.events ?? []).map((e): SessionEvent => ({
      type: e.type,
      // The server returns the payload decoded, as SSE does: same shape on both sides, or
      // `transcript()` would need to know the origin.
      //
      // `ts` is folded INTO `data`, as SSE does (`routes.ts`, `writeSSE`): here it arrives NEXT TO
      // the payload, and `fmtTime` (tasks/trace-text.ts) only reads `data.ts`. Without this,
      // history rendered a trace WITHOUT TIMES, and since it wins dedup on `dbId`, the live session
      // lost its times on reload too.
      data: {
        ...((e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<
          string,
          unknown
        >),
        ts: e.ts,
      },
      dbId: e.dbId,
      sessionId: e.sessionId,
    }));
    // An event without `dbId` cannot be deduplicated: kept at its arrival place. It does not happen
    // with the current server, and dropping it would erase agent speech over a transport detail.
    const seen = new Set<number>();
    const out: SessionEvent[] = [];
    for (const e of [...past, ...live.events]) {
      if (e.dbId === undefined) {
        out.push(e);
        continue;
      }
      if (seen.has(e.dbId)) continue;
      seen.add(e.dbId);
      out.push(e);
    }
    return out.sort(
      (a, b) => (a.dbId ?? Number.MAX_SAFE_INTEGER) - (b.dbId ?? Number.MAX_SAFE_INTEGER),
    );
  }, [history.data, live.events]);

  return {
    events,
    sessions: history.data?.sessions ?? [],
    stream: live.stream,
    reconnect: live.reconnect,
  };
}
