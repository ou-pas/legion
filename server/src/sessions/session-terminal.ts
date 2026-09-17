// The only path to make a session terminal (`destroyed` / `failed`).
//
// On 20/08 `recoverOrphanSessions` set `failed` in the database without publishing a single event,
// leaving diagnosis by elimination (no `run_error`, no `result`, a `tool_start` without its
// `tool_end`). That path was fixed, but nothing stopped ANOTHER status writer from repeating the
// same silence: fixing one bug does not close the class.
//
// This function IS the lock: the only place allowed to set `destroyed` or `failed` on a session,
// and it REQUIRES a reason, with no default, because a generic default ("error") would be the same
// silence: nobody could reconstruct what happened reading it six months later. A caller with no
// reason to give has a bug, not a case to cover.
import { type schema } from "../shared/db.js";
import { publish } from "../shared/events.js";
import { logControlEvent } from "../events/control-log-store.js";
import { writeSessionEnd } from "./session-terminal-store.js";

/** The type comes from the column (drizzle/schema.ts), not a list written next to it: a status added
 *  to the schema without being named below does not compile. */
export type SessionStatus = (typeof schema.sessions.$inferSelect)["status"];

/** The seven statuses, named. No status literal elsewhere in the code: the domain says
 *  `SESSION_STATUS.waiting`, and the SERIALISED value is a detail of this table. The key carries the
 *  concept, the value the serialisation: renaming the stored value touches one line here instead of
 *  sixty literals across server, UI, tests and fixtures.
 *
 *  Labels do not belong here: they live in the UI catalogue (`web/src/sessions/text.ts`), keyed by
 *  these values. The server decides, the UI names. */
export const SESSION_STATUS = {
  starting: "starting",
  running: "running",
  /** Waiting for a human gesture OR an automatic wake-up. The reason is on the inbox entry
   *  (`inbox/wait-reason.ts`), not here: a status carrying six reasons would be the defect just
   *  fixed. */
  waiting: "waiting",
  /** Stopped on an approval DECISION (slice nav/11): alive, and no automation may write into it. */
  blocked: "blocked",
  committing: "committing",
  destroyed: "destroyed",
  failed: "failed",
} as const satisfies Record<string, SessionStatus>;

export const TERMINAL_STATUSES = [SESSION_STATUS.destroyed, SESSION_STATUS.failed] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/** The complement: statuses promising work is still in progress. `waiting` is included, the subtle
 *  point: a paused session has no container but will resume, so its task is not finished.
 *
 *  `blocked` (slice nav/11) is included for EXACTLY the same reason, the slice's trap: a session
 *  stopped on an approval gate is ALIVE. Forgetting it here would purge it with its project, drop it
 *  from the active session count, and let a review restart on a task still awaiting a decision.
 *  There were FIVE private copies of this list in the server (purge, goals x2, manager x2, review);
 *  they all point here now, because a status addition goes unnoticed in a copy. */
export const ACTIVE_STATUSES = [
  SESSION_STATUS.starting,
  SESSION_STATUS.running,
  SESSION_STATUS.waiting,
  SESSION_STATUS.blocked,
  SESSION_STATUS.committing,
] as const;

/**
 * Sets `status` + `endedAt` in the database, then ALWAYS publishes a `status` event carrying the
 * reason, in that order, so a live SSE subscriber never sees the event before the row is updated.
 *
 * `extra` carries caller-specific fields (`exitCode`, `reaped`, `stopped`…): they are ADDED to
 * `status`/`reason`, never replace them. An `extra` containing `status` or `reason` is a caller bug.
 */
export function markSessionTerminal(
  sessionId: string,
  status: TerminalStatus,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  if (!reason || !reason.trim())
    throw new Error(
      "markSessionTerminal: a reason is required — it is up to the caller to provide one, " +
        "this function does not invent any.",
    );
  const why = reason.trim();
  writeSessionEnd(sessionId, status, new Date(), why);
  publish(sessionId, "status", { ...extra, status, reason: why });
  announceSessionEnded(sessionId);
}

/**
 * What follows a session end, without this file knowing what (06/09).
 *
 * One hook is wired today: opening a PR when the session pushed code (slice nav/12, product rule of
 * 30/08). It lived here hard-coded through `await import("../review/open-pr.js")`, because
 * `review/open-pr.ts` reaches back here through `tasks/lifecycle.ts` (they share `taskBranch`) and
 * a static import would have closed the cycle. An `import()` does not break a cycle, it makes it
 * unreadable: the dependency is INVERTED. `markSessionTerminal` ANNOUNCES an end, `index.ts` says
 * who listens.
 *
 * The announcement stays HERE, not in `runLifecycle`, for the same reason as this file's header and
 * `session-guard.ts`: `markSessionTerminal` IS the terminal path, so an end path written later by
 * someone unaware of the rule still applies it. Hooking PR opening on `runLifecycle` would have left
 * out manual stop, orphan recovery and aborted start, three session ends perfectly able to have
 * pushed. The end status does not decide either: `destroyed` and `failed` both pass here.
 *
 * A throwing hook does NOT interrupt the close: the session is over, the code is pushed, and failing
 * a session end over a forge outage would lose the work twice.
 */
type SessionEndHook = (sessionId: string) => void;
const endHooks: SessionEndHook[] = [];

export function onSessionEnded(hook: SessionEndHook): void {
  endHooks.push(hook);
}

function announceSessionEnded(sessionId: string): void {
  for (const hook of endHooks) {
    try {
      hook(sessionId);
    } catch (err: unknown) {
      logControlEvent(
        "error",
        "session",
        `session end hook failed: ${String((err as Error)?.message ?? err)}`,
        { sessionId },
      );
    }
  }
}
