// Automatic relaunch of a long run (10/09): the other outcome of the turn budget.
//
// The defect. The turn counter punished LENGTH: at 175 a session stopped for being long, even when it
// had been pushing work for an hour. Operator's words: a run looping and a run moving are two
// different things. The container now measures what the session PRODUCES
// (`runner-payload/inertia.mts`); what was missing was someone to restart it when it moves, otherwise
// the inertia pause left it alive with nobody, hence dead at the 400 wall.
//
// No new rail, deliberately: the out-of-quota pause's, proven since 23/08. An inbox entry with a
// wake-up TIME (`wakeAt`) puts the session in `waiting`, the container is destroyed (so nothing
// costs anymore), `sdkSessionId` is kept, and the scheduler tick answers with `answeredBy:
// "system"`. `resumeSession` does the rest: new container, same task, same branch, same
// conversation, turn counter at zero (one counter per container). The wake-up time is NOW.
//
// No question to the operator. That is the point of the decision, and its cost is accepted: there
// is NO ceiling on the number of relaunches. Asking for a click every 375 turns would forbid an
// unattended night of work, exactly what is wanted. What bounds it is the notification at the third
// relaunch, and the operator keeps stop and pause at any time.
//
// The 400 wall stays in each session, but not for the reason long written here: raising `maxTurns`
// does NOT make the conversation swell without end. `resume` reloads the SAME conversation
// (`sdk-options.mts` passes `resume: spec.resume.sdkSessionId`, no reset), and the SDK bounds its
// own window (autocompact, `PreCompact`/`PostCompact` hooks, `SDKCompactBoundaryMessage`): a session
// restarting at turn 1 carries exactly the conversation it would have carried at turn 401. What the
// relaunch brings is a reset turn counter and a clean container, not a new conversation. `maxTurns`
// stays a net against pathological loops, NOT a work limit; stalls are `stuck.mts`'s job. The wall
// reached anyway is observed elsewhere (`turn-wall.ts`).
import { Hono } from "hono";
import { logControlEvent } from "../events/control-log-store.js";
import { sessionRow } from "./turn-relaunch-store.js";
import { authSession } from "./internal-routes.js";
import { parseBody } from "../http/parse-body.js";
import { relaunchBody } from "./internal-schemas.js";
import { createInboxMessage } from "../inbox/inbox.js";
import { INBOX_KIND } from "../inbox/inbox-enums.js";
import { WAIT_REASON } from "../inbox/wait-reason.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { publish } from "../shared/events.js";
import { SESSION_STATUS } from "./session-terminal.js";
import { done, refuse, type Result } from "../http/from-result.js";

/** What the session produced, measured by the container that watched it. The control plane recounts
 *  nothing: it has neither turns nor tool writes, and a second counter here would be a second place
 *  to be wrong (lesson of 03/09: three guardrails hanging on the same never-true test). */
export type RelaunchMeasure = {
  /** Turns since the last output. */
  idleTurns: number;
  /** The turn of that output, 0 if nothing ever came out. */
  sinceTurn: number;
  commits: number;
  writes: number;
  lastCommitTurn: number | null;
  /** Does the session have at least one writable repository? Otherwise it has no inertia pause. */
  writable: boolean;
};

export type RelaunchRequest = {
  used: number;
  pauseAt: number;
  cap: number;
  /** The text the next session reads, composed in the container (`prompt.mts`): it carries the
   *  measurement and the question. One place writes what the agent is told about its turns. */
  notice: string;
  measure: RelaunchMeasure;
};

/** Bound on the resume text: it enters the next session's prompt, and a prompt is not an appendix.
 *  Same spirit as the bounded fields of an inbox entry. */
export const RELAUNCH_NOTICE_MAX = 4000;

/** At the THIRD relaunch of a session the operator is notified, once. Three resumes mean more than
 *  five hundred turns of work: perfectly legitimate (a night of translation) or a sign of a task that
 *  never should have fit in one task. Nobody needs to act on the first or second, and notifying again
 *  at the fourth would wear the notification out like the others that were removed. */
export const RELAUNCH_NOTIFY_AT = 3;

/** The entry body has two readers, which is why there is only one text.
 *
 *  The operator reads it in their queue, wanting the measurement and the resume number; the woken
 *  session receives it as is as its answer (`wakeDueQuotaPauses` then the resume prompt), because it
 *  is the only place the text survives the death of the container that composed it. Two texts would
 *  have needed another column. */
function entryBody(req: RelaunchRequest, resume: number, notice: string): string {
  const m = req.measure;
  const what = m.writable
    ? `${m.commits} commit(s) pushed, ${m.writes} successful write(s)`
    : `${m.writes} successful write(s), no repo in write mode`;
  const head =
    `Automatic resume no. ${resume}: ${req.used} turns consumed (pause at ${req.pauseAt}, ` +
    `hard SDK wall at ${req.cap}) and the session IS MOVING — ${what}, last output at turn ` +
    `${m.sinceTurn || req.used}. It starts again on its own in a fresh container, on the same task ` +
    `and the same branch. No answer expected.`;
  return notice ? `${head}\n\n${notice}` : head;
}

/**
 * The session hit its turn budget WHILE MOVING: restart it.
 *
 * Three writes, in this order, each with its reader: the task TRACE (the thread reread to understand
 * a session), the CONTROL PLANE log (where one investigates hours later why a task ran six times),
 * and the inbox ENTRY, which is the resume button itself.
 *
 * The announced resume number is the COMING one: `resumeCount` is incremented by `resumeSession` at
 * wake-up, not here.
 */
export function relaunchForTurnBudget(
  sessionId: string,
  req: RelaunchRequest,
): Result<{ inboxId: string; resume: number }> {
  const session = sessionRow(sessionId);
  if (!session) return refuse(404, "unknown session");
  // A session already paused, stopped or dead has nothing to restart. `createInboxMessage` would
  // know (a non-blocking entry closes at once) but would not SAY so, and the container would believe
  // its relaunch granted.
  if (session.status !== SESSION_STATUS.running && session.status !== SESSION_STATUS.starting)
    return refuse(409, `session ${session.status}: nothing to restart`);

  const resume = session.resumeCount + 1;
  const body = entryBody(req, resume, req.notice.trim().slice(0, RELAUNCH_NOTICE_MAX));

  // In the trace next to `turn_budget_warning` and `repo_checkpoint`: the three tell the same story,
  // and a relaunch missing from the thread would leave a gap of hours between two containers.
  publish(sessionId, "turn_relaunch", {
    used: req.used,
    pauseAt: req.pauseAt,
    cap: req.cap,
    resume,
    ...req.measure,
  });
  logControlEvent(
    "info",
    "turns",
    `session ${sessionId} restarted automatically at turn ${req.used} (resume ${resume}): it is moving`,
    {
      sessionId,
      taskId: session.taskId,
      used: req.used,
      pauseAt: req.pauseAt,
      resume,
      ...req.measure,
    },
  );

  const created = createInboxMessage(sessionId, {
    kind: INBOX_KIND.text,
    body,
    impact:
      "Nothing is lost: work pushed to the branch, conversation preserved — the resume picks up exactly where the session stopped.",
    // NOW: nothing to wait for, unlike the out-of-quota pause. The scheduler tick (30 s) finds it
    // due on its next pass, once the container is destroyed; answering earlier would hit a session
    // still alive.
    wakeAt: new Date(),
    reason: WAIT_REASON.turnRelaunch,
  });

  if (resume === RELAUNCH_NOTIFY_AT)
    notifyOut(NOTIF_EVENT.sessionRelaunched, {
      sessionId,
      taskId: session.taskId,
      resume,
      used: req.used,
      commits: req.measure.commits,
      writes: req.measure.writes,
    });

  return done({ inboxId: created.id, resume });
}

/** The route lives with its service (same choice as `request-repo.ts` on 09/09):
 *  `registerInternalRoutes` is already the repository's longest function, and the architecture
 *  harness refuses to let it grow.
 *
 *  No `inboxAccess` guard, unlike `inbox_ask` and `propose_task`: this is not an agent tool. The
 *  model cannot call it (it is declared in no MCP tool), and an agent without inbox rights has the
 *  same right as another to finish its work. The session's `callbackToken` authorises it, as for the
 *  trace. */
export function registerTurnRelaunchRoute(app: Hono): void {
  app.post("/internal/sessions/:id/relaunch", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const parsed = await parseBody(c, relaunchBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const res = relaunchForTurnBudget(session.id, parsed.value);
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true, ...res.value }, 201);
  });
}
