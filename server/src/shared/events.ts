// In-memory event bus: session events fan out to SSE subscribers and persist to DB.
// Events carry their DB row id so SSE consumers can dedupe replay vs live (review #3).
import {
  bumpSessionEventCount,
  insertSessionEvent,
  maxSeqOf,
  sessionEventRows,
} from "./events-store.js";

export type SessionEvent = { dbId: number; type: string; payload: unknown; ts: number };

/** Event types a server decision depends on, named because `type` is a bare string: a copied
 *  literal would silently stop matching after a runner-payload rename. Not exhaustive
 *  (`events/control-stream.ts` has `CONTROL_EVENT_TYPES` for screen staleness). */
export const REPO_PUSH_EVENT = "repo_push";
export const FS_OP_EVENT = "fs_op";
/** The periodic net that commits and pushes leftovers every fifteen turns. Emitted by
 *  `runner-payload/repos.mts` only when HEAD moved and the push succeeded, so it proves a remote
 *  commit like `repo_push`. */
export const REPO_CHECKPOINT_EVENT = "repo_checkpoint";
type Listener = (ev: SessionEvent) => void;
/** A listener that receives every session's events, with the session id. */
type AllListener = (sessionId: string, ev: SessionEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const allListeners = new Set<AllListener>();

export function subscribe(sessionId: string, fn: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) listeners.set(sessionId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(sessionId);
  };
}

/** Subscribes to everything on the bus. One consumer today, `events/control-stream.ts`. Low-level
 *  on purpose: filtering is not the bus's job. */
export function subscribeAll(fn: AllListener): () => void {
  allListeners.add(fn);
  return () => {
    allListeners.delete(fn);
  };
}

export function publish(sessionId: string, type: string, payload: unknown): void {
  store(sessionId, null, type, payload);
}

/** Broadcast without writing, for screen sync that is not part of the session's history (16/09:
 *  inbox draft saves put ten identical lines in fifty seconds on a trace).
 *
 *  `dbId: 0`: an ephemeral event has no rank in the trace, so SSE resume (`Last-Event-ID`) ignores
 *  it; there is nothing to replay. */
export function broadcast(sessionId: string, type: string, payload: unknown): void {
  const ev: SessionEvent = { dbId: 0, type, payload, ts: Date.now() };
  for (const fn of listeners.get(sessionId) ?? []) fn(ev);
  for (const fn of allListeners) fn(sessionId, ev);
}

/** Publishes an event numbered by the runtime (v36). Returns `false` if the seq is already stored,
 *  and then nothing happens (no row, counter or broadcast), so the runtime can resend its queue
 *  for free. Callers must gate their own side effects on this boolean: a duplicate must not
 *  notify again. */
export function publishSeq(
  sessionId: string,
  seq: number,
  type: string,
  payload: unknown,
): boolean {
  return store(sessionId, seq, type, payload);
}

/** Highest stored seq for this session, 0 if none: the ack the runtime reads to know what to
 *  resend. */
export function ackOf(sessionId: string): number {
  return maxSeqOf(sessionId) ?? 0;
}

function store(sessionId: string, seq: number | null, type: string, payload: unknown): boolean {
  const ts = Date.now();
  // A duplicate is normal: the runtime resends what it has not seen acknowledged.
  const inserted = insertSessionEvent({
    sessionId,
    seq,
    type,
    payload: JSON.stringify(payload ?? {}),
    createdAt: new Date(ts),
  });
  if (inserted.changes === 0) return false;
  bumpSessionEventCount(sessionId);
  const ev: SessionEvent = { dbId: Number(inserted.lastInsertRowid), type, payload, ts };
  for (const fn of listeners.get(sessionId) ?? []) fn(ev);
  // Global listeners after the session's own, never instead of them.
  for (const fn of allListeners) fn(sessionId, ev);
  return true;
}

/** `afterDbId` serves SSE resume (`Last-Event-ID`): only what follows is replayed, not the whole
 *  trace on every reconnect. */
export function replay(sessionId: string, afterDbId = 0): SessionEvent[] {
  return sessionEventRows(sessionId, afterDbId).map((r) => ({
    dbId: r.id,
    type: r.type,
    payload: JSON.parse(r.payload),
    ts: r.createdAt.getTime(),
  }));
}
