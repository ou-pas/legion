// Each task's MOST RECENT session: a task resumed after failure has several, and the last one says
// today's state and cost. Same sort as Board.tsx and TaskPage.tsx (ascending by start, last write
// wins), shared here so the chain flow does not copy the task → session map a fourth time.
import type { Session } from "../api/sessions.js";

export function latestSessionByTask(sessions: readonly Session[]): Map<string, Session> {
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const m = new Map<string, Session>();
  for (const s of sorted) m.set(s.taskId, s);
  return m;
}
