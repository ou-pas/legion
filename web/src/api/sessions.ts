import { json, post } from "./client.js";

/** Mirror of `RUNNER_KIND` (server/src/shared/enums.ts). `docker` covers the local daemon AND a
 *  remote one (`ssh://`): what changes is the host, not the kind. */
export const RUNNER_KIND = { docker: "docker", process: "process" } as const;
export type RunnerKind = (typeof RUNNER_KIND)[keyof typeof RUNNER_KIND];

export type RunnerRow = { id: string; name: string; kind: string; enabled: boolean };

/** The seven session statuses, mirror of the server's `SESSION_STATUS`
 *  (`sessions/session-terminal.ts`). The mirror is needed because the two halves share a STRING,
 *  never a type (see `make contract`). The key carries the concept and the value the serialisation,
 *  which makes a rename one line on each side instead of sixty literals: no status literal should
 *  reappear in code. Labels live in `sessions/text.ts`, colours in `sessions/session-status.ts`. */
export const SESSION_STATUS = {
  starting: "starting",
  running: "running",
  /** The REASON is on the inbox item (`InboxItem.reason`), not here. */
  waiting: "waiting",
  /** Stopped on an approval DECISION (slice nav/11): alive, and no automation may write to it. A
   *  pause waits for an answer, a gate waits for a ruling. */
  blocked: "blocked",
  committing: "committing",
  destroyed: "destroyed",
  failed: "failed",
} as const;

/** In lifecycle order. Iterable: stories render the series and state derivation sweeps it to prove
 *  no status falls into a `default`. */
export const SESSION_STATUSES = [
  SESSION_STATUS.starting,
  SESSION_STATUS.running,
  SESSION_STATUS.waiting,
  SESSION_STATUS.blocked,
  SESSION_STATUS.committing,
  SESSION_STATUS.destroyed,
  SESSION_STATUS.failed,
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Statuses promising work is still in progress, mirror of the server's `ACTIVE_STATUSES` (which
 *  decides whether `settleTaskAfterSession` may settle the task). The server had FIVE private
 *  copies before they were merged, and an added status goes unnoticed in a copy: keep only this one. */
export const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  SESSION_STATUS.starting,
  SESSION_STATUS.running,
  SESSION_STATUS.waiting,
  SESSION_STATUS.blocked,
  SESSION_STATUS.committing,
];

/** `destroyed` does NOT mean "succeeded": an operator stop and a zero exit both land there. */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = [
  SESSION_STATUS.destroyed,
  SESSION_STATUS.failed,
];

export type Session = {
  id: string;
  taskId: string;
  agentId: string;
  runnerId: string;
  model: string;
  /** `waiting` and `blocked` are both inbox pauses (container destroyed, session alive), but no
   *  automation may write into `blocked`. */
  status: SessionStatus;
  costUsd: number | null;
  resumeCount: number;
  startedAt: string;
  endedAt: string | null;
  /** Why it stopped (v22); null while alive, or if it ended before the column existed. */
  endReason: string | null;
};

export const sessionsApi = {
  resumeCommand: (sessionId: string): Promise<{ command: string }> =>
    fetch(`/api/sessions/${sessionId}/resume-command`).then(json),
  analytics: (): Promise<
    {
      agent: string;
      model: string;
      runs: number;
      failed: number;
      costUsd: number;
      avgDurationMs: number;
      failRate: number;
    }[]
  > => fetch("/api/analytics").then(json),
  stopSession: (id: string) => post(`/api/sessions/${id}/stop`),
  /** Requested pause (26/08): the agent stops at the end of its turn, pushes its work, and an inbox
   *  item resumes it. Refused outside `running`, notably during `committing`, where interrupting
   *  would be the one way to lose work. 404/409 carry the server's sentence, shown verbatim. */
  pauseSession: (id: string) => post(`/api/sessions/${id}/pause`),
  /** Steering (v23): talk to a RUNNING session without stopping it. Outside `running` the server
   *  answers 404/409 and `json` rejects with its sentence, written to be shown to the operator
   *  verbatim, not summarised as "error". */
  steerSession: (
    id: string,
    text: string,
  ): Promise<{ ok: true; steerId: string; text: string; truncated: boolean }> =>
    post(`/api/sessions/${id}/steer`, { text }),
  /** Ends sessions whose container exited now, instead of waiting for the periodic sweep. */
  reapSessions: (): Promise<{ reaped: number }> => post("/api/sessions/reap"),
};
