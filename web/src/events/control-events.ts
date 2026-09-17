// What an event makes stale: the table, and only it.
//
// The server (`server/src/events/`) pushes SIGNALS: a type, ids, no body. The whole "this signal
// makes that list stale" translation lives here, next to `queries.ts` which holds the keys.
// Scattering it (a line in the task page, another in the Kanban) would guarantee that some screen
// silently stops refreshing one day, a failure that looks like "nothing is happening".
//
// Reading rule: a PREFIX is invalidated to wake a family. `["inbox"]` covers
// `["inbox", "pending-by-project"]`, `["tasks"]` covers a task's lineage and batch. That keeps the
// table short.
//
// An unknown type does nothing, on purpose: the server may learn to broadcast a signal before the
// screen knows what to do with it, and vice versa. The `queries.ts` safety net (60 s) catches that
// case, which is exactly the role left to it.
import type { QueryKey } from "@tanstack/react-query";
import { qk } from "../queries.js";

/** What the server sends on `/api/events`. Deliberately tolerant: ids can be null (a session whose
 *  task was deleted), and a field added by the server tomorrow must not break today's reading. */
export type ControlEvent = {
  type: string;
  sessionId?: string;
  taskId?: string | null;
  projectId?: string | null;
  ts?: number;
};

/** Returns `null` for anything that is not an object with a `type`: an unreadable line must neither
 *  throw (the `EventSource` would die) nor invalidate at random. */
export function parseControlEvent(raw: string): ControlEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const ev = parsed as ControlEvent;
    return typeof ev.type === "string" && ev.type.length > 0 ? ev : null;
  } catch {
    return null;
  }
}

type KeysOf = (ev: ControlEvent) => QueryKey[];

/** A task's life. Goals follow their tasks' progress: without them here a running goal's page would
 *  only have the safety net, and its thread would freeze for a minute. */
const taskLife: KeysOf = (ev) => (ev.projectId ? [qk.tasks, qk.goals(ev.projectId)] : [qk.tasks]);

/** What awaits a decision. `["inbox"]` also covers per-project badges; `tasks` too, because an open
 *  question changes the state read on the task card. */
const decision: KeysOf = () => [qk.inbox, qk.tasks];

/** The artifacts of THE task concerned, not all. Without an id, fall back to the prefix: one list
 *  refetched too many beats an invisible `pr.md`. */
const artifacts: KeysOf = (ev) => [ev.taskId ? qk.artifacts(ev.taskId) : qk.allArtifacts];

const work: KeysOf = (ev) => [...artifacts(ev), qk.tasks];

/** One type per line, facing the family it wakes. */
export const INVALIDATION: Readonly<Record<string, KeysOf>> = {
  // Runner transitions: started, running, waiting, destroyed, failed.
  status: taskLife,
  task_status: taskLife,
  task_proposed: taskLife,
  result: taskLife,
  run_error: taskLife,
  inbox_ask: decision,
  inbox_answer: decision,
  inbox_note: decision,
  // A round started ELSEWHERE, another tab or the phone (07/09). It does not change what waits, it
  // changes what is read on it ("0 / 6" becomes "2 / 6") on four surfaces at once. The `inbox`
  // prefix also covers the question page, whose key lives under it (`qk.inboxQuestion`).
  inbox_draft: decision,
  dependency_wait: decision,
  dependency_resolved: decision,
  repo_push: work,
  repo_push_failed: work,
  // A file written by the agent: how an artifact appears, `pr.md` last.
  fs_op: artifacts,
};

/** Empty for a type the screen does not know. */
export function keysFor(ev: ControlEvent): QueryKey[] {
  return INVALIDATION[ev.type]?.(ev) ?? [];
}
