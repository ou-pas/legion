// The control stream: what, in the control plane's life, makes a screen stale.
//
// Measured on 02/09 with a task page open and idle: five calls every four seconds (tasks, links,
// inbox, pending-by-project, artifacts), 75 requests a minute per viewer, fifteen of them 460 KB
// for `/api/tasks` alone. Every change already went through `publish()` (shared/events.ts); the bus
// existed, nobody served it beyond one session.
//
// This module creates no event: it subscribes to the bus and projects what passes. It carries no
// body, only a type and ids; sending the data down two paths would mean two truths to reconcile,
// and the 7 MB/min we just removed. It does not replace `/api/sessions/:id/live`, which carries a
// session's output and resumes with `Last-Event-ID`; this one carries staleness signals, has
// nothing to replay, and a reconnect means "invalidate everything" on the screen.
//
// The allowlist is the core: `text`, `tool_start` and `tool_end` fill a session's trace, whose page
// has its own stream, and broadcasting them here would wake every other page for nothing.
import { subscribeAll, type SessionEvent } from "../shared/events.js";
import { taskAndProjectOfSession } from "./control-stream-store.js";

/** Enough to decide which list is stale, nothing more. `taskId` and `projectId` can be null if the
 *  session vanished between publish and read; the screen then falls back to the global keys. */
export type ControlEvent = {
  type: string;
  sessionId: string;
  taskId: string | null;
  projectId: string | null;
  ts: number;
};

/** The types that make a screen stale:
 *   · `status`: runner transitions (starting, running, waiting, destroyed, failed);
 *   · `task_status`, `task_proposed`, `result`, `run_error`: a task's life;
 *   · `inbox_*`, `dependency_*`: what waits for a decision, and sleeping on a dependency;
 *   · `repo_push`, `repo_push_failed`: the branch and its PR;
 *   · `fs_op`: an artifact was just written (pr.md arrives at the very end). */
export const CONTROL_EVENT_TYPES = [
  "status",
  "task_status",
  "task_proposed",
  "result",
  "run_error",
  "inbox_ask",
  "inbox_answer",
  "inbox_note",
  // `inbox_draft` (07/09): a round started elsewhere (another tab, the phone). Nothing new waits,
  // but four surfaces show "2 / 6 · Resume" and would stay at "0 / 6" until the 60 s fallback.
  "inbox_draft",
  "dependency_wait",
  "dependency_resolved",
  "repo_push",
  "repo_push_failed",
  "fs_op",
] as const;

const RELEVANT: ReadonlySet<string> = new Set(CONTROL_EVENT_TYPES);

/** Returns `null` for anything that makes no screen stale: the filter lives here and only here. */
export function toControlEvent(sessionId: string, ev: SessionEvent): ControlEvent | null {
  if (!RELEVANT.has(ev.type)) return null;
  // No memo: a session→task cache would live as long as the process to save a microsecond SQLite
  // read, and would then need bounding, invalidation and tests.
  const row = taskAndProjectOfSession(sessionId);
  return {
    type: ev.type,
    sessionId,
    taskId: row?.taskId ?? null,
    projectId: row?.projectId ?? null,
    ts: ev.ts,
  };
}

const listeners = new Set<(ev: ControlEvent) => void>();
/** One bus subscription for all viewers: the projection reads the database, and doing it once per
 *  open connection would multiply that read by the number of tabs for the same result. */
let unsubscribeBus: (() => void) | null = null;

function onBusEvent(sessionId: string, ev: SessionEvent): void {
  if (!RELEVANT.has(ev.type)) return;
  const control = toControlEvent(sessionId, ev);
  if (!control) return;
  // A listener removed during the broadcast does not shift iteration: a `Set` skips removed entries.
  for (const fn of listeners) fn(control);
}

/** The first subscriber attaches the bus, the last to leave detaches it: with no viewer this
 *  module costs no read. */
export function subscribeControl(fn: (ev: ControlEvent) => void): () => void {
  listeners.add(fn);
  unsubscribeBus ??= subscribeAll(onBusEvent);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      unsubscribeBus?.();
      unsubscribeBus = null;
    }
  };
}
