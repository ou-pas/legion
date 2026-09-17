// A task's full thread, across sessions (Channels, follow-up of HSV_FFG00R /
// artifact /artifacts/lOp4YXkSTJ/implementation.md).
//
// `GET /api/sessions/:id/live` (routes.ts) is scoped to ONE session: the right transport for the
// LIVE session (SSE, `Last-Event-ID` dedup, `stream_end`, reconnect), untouched here. But a task
// relaunched, resumed after an inbox pause or after a failure has SEVERAL sessions, and nothing
// stitched their events together: a task's channel could only show the last one.
//
// The PAST is frozen, only the PRESENT needs a stream. This module reads the history in one go (all
// the task's sessions, finished or not) and the UI keeps following the live session through
// `/api/sessions/:id/live`. No new SSE stream.
//
// Decisions:
//  - Filter by taskId (JOIN sessions → session_events), never by a single sessionId, same reason as
//    `listTaskInboxHistory` (inbox-history.ts): the timeline must cross sessions.
//  - `sessionId` carried on EACH event, never derived client-side: it lets the UI draw the break
//    between two sessions.
//  - Sorted by `id`, the global autoincrement PK of `session_events`: the id IS the insertion order,
//    hence exact chronology; `createdAt` can tie at the millisecond.
//  - `since` follows the `replay()` contract (shared/events.ts): the id of the last event the client
//    knows, one integer since the id is global.
//  - `sessions` comes with the events even when `since` returns none: the UI needs EACH session's
//    bounds (status, start, end) to label the break.
import { eventRowsOfSessions, sessionRowsOfTask } from "./task-events-store.js";

export type TaskEvent = {
  dbId: number;
  sessionId: string;
  type: string;
  payload: unknown;
  ts: number;
};

export type TaskEventSession = {
  id: string;
  status: string;
  agentId: string;
  model: string;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
};

export type TaskEventsPage = { sessions: TaskEventSession[]; events: TaskEvent[] };

/** Oldest start first. Exported separately from `listTaskEvents`: the route needs it even when
 *  `since` filters out every event (common on a client SSE resume), to label the break without
 *  re-describing each session from its events alone. */
export function listTaskSessions(taskId: string): TaskEventSession[] {
  return sessionRowsOfTask(taskId).map((s) => ({
    id: s.id,
    status: s.status,
    agentId: s.agentId,
    model: s.model,
    startedAt: s.startedAt.getTime(),
    endedAt: s.endedAt?.getTime() ?? null,
    endReason: s.endReason,
  }));
}

/** All `session_events` of all the task's sessions, chronological, `sessionId` on each.
 *  `afterDbId` follows the `replay()` contract (shared/events.ts): 0 (default) = from the start. */
export function listTaskEvents(taskId: string, afterDbId = 0): TaskEventsPage {
  const sessions = listTaskSessions(taskId);
  if (sessions.length === 0) return { sessions: [], events: [] };
  const sessionIds = sessions.map((s) => s.id);
  const events = eventRowsOfSessions(sessionIds, afterDbId).map((r) => ({
    dbId: r.id,
    sessionId: r.sessionId,
    type: r.type,
    payload: JSON.parse(r.payload) as unknown,
    ts: r.createdAt.getTime(),
  }));
  return { sessions, events };
}
