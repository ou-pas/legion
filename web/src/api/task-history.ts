// A task's thread across all its sessions. `GET /api/sessions/:id/live` (SSE, `Last-Event-ID`
// resume) is scoped to ONE session, but a relaunched or resumed task has several, and the screen
// only showed the last. This route came with PR #43 for exactly that. The past is frozen and only
// the present needs a stream: history is read once, live still flows through the live session's SSE.
import { json } from "./client.js";

export type TaskEvent = {
  /** The database row id: a global primary key, so the exact chronological order. It is also the
   *  SSE event id, which lets the two sources be deduplicated against each other. */
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

export const taskHistoryApi = {
  /** `since` = the id of the last known event. One integer is enough, the id is global. */
  events: (taskId: string, since = 0): Promise<TaskEventsPage> =>
    fetch(`/api/tasks/${taskId}/events${since > 0 ? `?since=${since}` : ""}`).then(json),
};
