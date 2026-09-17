// Steering (v23): talking to an agent WHILE it works, without stopping it.
//
// Until then the only moment to tell an agent something was when IT asked a question (inbox → pause
// → answer → resume). An agent heading the wrong way was watched going wrong, or stopped. The plan
// said otherwise (plan.md §135: send a message without stopping the session); this module is that
// link.
//
// Three structural decisions, each defensible on its own:
//
//  1. A QUEUE IN THE DATABASE, not a push to the container. Nothing in the control plane opens a
//     connection to a runtime: the runtime calls back on the EXISTING callback channel (the inbox's,
//     same token, same port). The message waits in the database and `deliveredAt` says whether it
//     reached the agent: a lost message cannot pass for delivered.
//
//  2. `running` AND NOTHING ELSE. A `waiting` session already has its channel (answering its
//     question) and no container left to listen; a finished session no longer listens. Accepting in
//     those states would swallow a message silently, the very defect being removed. The refusal
//     NAMES the state, otherwise it cannot be fixed.
//
//  3. A VISIBLE USER TURN. Each injection writes `steer` in the trace when sent, and
//     `steer_delivered` when the runtime takes it. The gap between the two events is exactly "the
//     agent has it" vs "not yet".
import { nanoid } from "nanoid";
import {
  humanSteerRowsForTask,
  insertSteer,
  markSteerDelivered,
  undeliveredSteersOf,
} from "./steering-store.js";
import { publish } from "../shared/events.js";
import { assertSessionWritable, type WriteSource } from "./session-guard.js";
import { SESSION_STATUS } from "./session-terminal.js";

/** A steering message is an instruction, not an appendix: beyond this it is a task to write, not
 *  an aside to slip into a running session. */
export const STEER_MAX_LEN = 4000;

/** How long the control plane holds the runtime's request before answering "nothing". Long enough
 *  for near-real-time delivery without hammering the server, short enough to stay well below any
 *  proxy idle timeout. */
export const STEER_HOLD_MS = 20_000;

export type SteerRefusal = { status: 404 | 409; error: string };

export type PendingSteer = { id: string; text: string; createdAt: number };

/**
 * Only `running` listens. Returns `null` if the injection is allowed, otherwise the refusal to relay
 * as is, with its reason, because a bare 409 makes the operator guess.
 *
 * PURE (it only takes the status): this feature's security boundary, testable without database or
 * session.
 */
export function steerRefusal(status: string | null | undefined): SteerRefusal | null {
  switch (status) {
    case "running":
      return null;
    case undefined:
    case null:
      return { status: 404, error: "session not found" };
    case "starting":
      return {
        status: 409,
        error:
          "the session is still starting: its runtime is not listening — try again in a moment",
      };
    case SESSION_STATUS.waiting:
      return {
        status: 409,
        error:
          "the session is paused on its question: its runtime is destroyed. Answer the inbox question — it is the same path",
      };
    // Two different questions, both asked here (slice nav/11). "Is the runtime listening?": no, a
    // blocked session gave back its container, like `waiting`. "May we write into it?": the other
    // guard, session-guard.ts, lives in the write gesture (`enqueueSteer`) because it must hold even
    // for a path that never calls this function.
    case "blocked":
      return {
        status: 409,
        error:
          "the session is stopped on an approval decision: its runtime is destroyed. " +
          "Settle it from the inbox — that is what resumes it",
      };
    case "committing":
      return {
        status: 409,
        error: "the session is pushing its work to the branch: it no longer listens",
      };
    case "destroyed":
    case "failed":
      return { status: 409, error: "the session is over: it no longer listens" };
    default:
      return {
        status: 409,
        error: `session in state “${String(status)}”: it is not listening`,
      };
  }
}

/** An empty message is not a message; an oversized one is not refused (that would lose the typing)
 *  but truncated, saying so. */
export function normalizeSteerText(
  raw: unknown,
): { ok: true; text: string; truncated: boolean } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "text required (a string)" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "empty message" };
  return trimmed.length > STEER_MAX_LEN
    ? { ok: true, text: trimmed.slice(0, STEER_MAX_LEN), truncated: true }
    : { ok: true, text: trimmed, truncated: false };
}

// Waking long-polling readers. The runtime holds a request open (`waitForSteers`) instead of
// polling every second; this registry wakes it the moment a message is injected.
const waiters = new Map<string, Set<() => void>>();

function wake(sessionId: string): void {
  const set = waiters.get(sessionId);
  if (!set) return;
  // Iterating directly despite removal along the way: each listener removes only ITSELF, and a Set
  // tolerates deleting the current or an already visited element. If a listener ever removed
  // another, this loop would need a copy.
  for (const fn of set) fn();
}

/** Stores the message and announces it in the trace. The STATE guard (`steerRefusal`) stays with the
 *  caller, which turns it into an HTTP code.
 *
 *  The blocked-session invariant is here (slice nav/11), in the write gesture rather than the
 *  caller: an injection path written tomorrow by someone unaware of `blocked` is refused anyway.
 *  `source` says who writes; only an explicit "human" passes. */
export function enqueueSteer(
  sessionId: string,
  text: string,
  source: WriteSource = "human",
): PendingSteer {
  assertSessionWritable(sessionId, source);
  const row = { id: nanoid(10), sessionId, text, source, createdAt: new Date(), deliveredAt: null };
  insertSteer(row);
  // The user turn enters the trace BEFORE the agent even receives it, which makes the send visible
  // in the UI at once.
  publish(sessionId, "steer", { steerId: row.id, text, source });
  wake(sessionId);
  return { id: row.id, text, createdAt: row.createdAt.getTime() };
}

/** Called by the internal route: what leaves here counts as delivered to the agent. */
export function takePendingSteers(sessionId: string): PendingSteer[] {
  const rows = undeliveredSteersOf(sessionId);
  if (rows.length === 0) return [];
  const now = new Date();
  for (const r of rows) {
    markSteerDelivered(r.id, now);
    publish(sessionId, "steer_delivered", { steerId: r.id });
  }
  return rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt.getTime() }));
}

/** What remains queued: for diagnosis ("did my message go?") and tests. */
export function pendingSteerCount(sessionId: string): number {
  return undeliveredSteersOf(sessionId).length;
}

/** HUMAN steers across ALL sessions of a task, chronologically (task-decisions.ts). `source ===
 *  "human"` only: the column exists to tell a future orchestrator from the operator, and a relaunch
 *  must never pass an automatic message off as a human decision. */
export function humanSteersForTask(taskId: string): { text: string; createdAt: number }[] {
  return humanSteerRowsForTask(taskId).map((r) => ({
    text: r.text,
    createdAt: r.createdAt.getTime(),
  }));
}

/**
 * Long poll: returns the queue as soon as it is not empty, or an empty array after `holdMs`. The
 * runtime calls back in a loop; an empty return is the normal case of a session nobody talks to.
 */
export function waitForSteers(
  sessionId: string,
  holdMs: number = STEER_HOLD_MS,
): Promise<PendingSteer[]> {
  const immediate = takePendingSteers(sessionId);
  if (immediate.length > 0) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let set = waiters.get(sessionId);
    if (!set) waiters.set(sessionId, (set = new Set()));
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      set.delete(listener);
      if (set.size === 0) waiters.delete(sessionId);
      resolve(takePendingSteers(sessionId));
    };
    const listener = () => finish();
    // Timer NOT `unref`: the held HTTP request already keeps the event loop, and a detached timer
    // would never answer, which is exactly what this timer must prevent.
    const timer = setTimeout(finish, holdMs);
    set.add(listener);
  });
}
