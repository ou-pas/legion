import { json, post, patch } from "./client.js";

/** What a scheduled firing produced, mirror of the server's `SCHEDULE_OUTCOME`. Three of the four
 *  are NOT errors: a disabled rule and a missed tick are non-events recorded to answer "why did
 *  nothing happen last night?". */
export const SCHEDULE_OUTCOME = {
  taskCreated: "task-created",
  skippedDisabled: "skipped-disabled",
  skippedMissed: "skipped-missed",
  error: "error",
} as const;
export const SCHEDULE_OUTCOMES = [
  SCHEDULE_OUTCOME.taskCreated,
  SCHEDULE_OUTCOME.skippedDisabled,
  SCHEDULE_OUTCOME.skippedMissed,
  SCHEDULE_OUTCOME.error,
] as const;
export type ScheduleOutcome = (typeof SCHEDULE_OUTCOMES)[number];

/** A task scheduled by a cron expression.
 *  - cron: 5 UTC fields (minute, hour, dayOfMonth, month, dayOfWeek)
 *  - either agentId+null prompt, or null agentId+templateId, or null agentId+prompt (direct)
 *  - nextRunAt computed by the server (null when disabled)
 */
export type Schedule = {
  id: string;
  projectId: string;
  name: string;
  cron: string; // "0 9 * * 1"
  agentId: string | null;
  templateId: string | null;
  prompt: string | null;
  enabled: boolean;
  lastRunAt: number | null; // epoch ms
  nextRunAt: number | null; // epoch ms
  createdAt: number; // epoch ms
};

/** One scheduled firing. `skipped-missed`: the cron was missed (server down) and not caught up. */
export type ScheduleRun = {
  id: string;
  scheduleId: string;
  firedAt: number; // epoch ms, the PLANNED time
  outcome: "task-created" | "skipped-disabled" | "skipped-missed" | "error";
  taskId: string | null; // set when outcome = "task-created"
  reason: string | null; // set when outcome = "error"
};

export const schedulesApi = {
  schedules: (projectId: string): Promise<Schedule[]> =>
    fetch(`/api/schedules?projectId=${projectId}`).then(json),

  /** With its last 10 firings. */
  schedule: (id: string): Promise<Schedule & { runs: ScheduleRun[] }> =>
    fetch(`/api/schedules/${id}`).then(json),

  scheduleRuns: (id: string, limit = 10): Promise<ScheduleRun[]> =>
    fetch(`/api/schedules/${id}/runs?limit=${limit}`).then(json),

  createSchedule: (body: {
    projectId: string;
    name: string;
    cron: string;
    agentId?: string | null;
    templateId?: string | null;
    prompt?: string | null;
    enabled?: boolean;
  }): Promise<Schedule> => post("/api/schedules", body),

  updateSchedule: (
    id: string,
    body: Partial<
      Pick<Schedule, "name" | "cron" | "agentId" | "templateId" | "prompt" | "enabled">
    >,
  ): Promise<Schedule> => patch(`/api/schedules/${id}`, body),

  deleteSchedule: (id: string): Promise<{ ok: boolean }> =>
    fetch(`/api/schedules/${id}`, { method: "DELETE" }).then(json),
};
