// Out-of-quota pause: when the subscription window is exhausted, the session does not die, it
// sleeps until the reset and then resumes on its own.
//
// Seen on 23/08 evening: the 5 h window turns `rejected` mid-work. On the SDK side nothing looks
// like a failure: a last text ("You've hit your session limit") then a `result` with **subtype:
// success**, and the process exits 0. On the board: a lying green finished chip, a task stuck in
// `doing`, no artifact, no way to resume except relaunching by hand hours later. Yet the control
// plane knew everything: the last persisted `throttle` event carries `status: rejected` AND
// `resets_at`.
//
// No new rail (same choice as wait_for_task): the pause IS the existing inbox path (container
// destroyed, `sdkSessionId` kept, resume through `answerInbox`). The only novelty is the wake-up
// trigger: a TIME (`wake_at`, v28) instead of a human or a done. The human keeps control: answering
// before the time wakes it at once, and the automatic wake-up then finds the entry closed. First to
// answer wins.
//
// v64: the pause is no longer the only outcome. A project carries an ordered list of accounts:
// exhaustion is RECORDED for the account that served, on ITS window, and if another is available
// the session restarts on it at once. The decision is in `quota-plan.ts`, without database or clock;
// this file reads the state and files the entry.
import { logControlEvent } from "../events/control-log-store.js";
import { openInboxWakeups, runAccountOf, throttleEventsOf } from "./quota-pause-store.js";
import { answerInbox, createInboxMessage } from "../inbox/inbox.js";
import { WAIT_REASON } from "../inbox/wait-reason.js";
import { currentRunStartedAt } from "./run-scope.js";
import { createLogger } from "../shared/log.js";
import { resolveProjectCredential } from "../projects/auth.js";
import { credentialsOfProject, recordExhaustion } from "../projects/credentials/index.js";
import { planQuotaPause } from "./quota-plan.js";
import type { QuotaRejection } from "./quota-plan.js";

const log = createLogger("quota-pause");

export type { QuotaRejection } from "./quota-plan.js";

/** Did the session just die out of quota? The LAST persisted `throttle` counts, the same source as
 *  /api/quota. A successful `result` proves nothing here: it is precisely what lied.
 *
 *  CURRENT run only (02/09): a previous run's rejection haunted every clean exit of later runs (the
 *  agent concluded in seconds, and the old `rejected` put it back to sleep). 24 resumes in a loop on
 *  Wv8klSI15U1B before anyone noticed. */
export function quotaRejection(sessionId: string): QuotaRejection | null {
  const since = currentRunStartedAt(sessionId);
  const rows = throttleEventsOf(sessionId);
  const last = rows[rows.length - 1];
  if (!last || last.createdAt.getTime() < since) return null;
  const p = JSON.parse(last.payload) as {
    kind?: string;
    status?: string;
    rateLimitType?: string;
    resetsAt?: number;
  };
  if (p.kind !== "rate_limit" || p.status !== "rejected") return null;
  // `resets_at` comes in epoch SECONDS (SDK contract, see quota-windows).
  const resetsAt =
    typeof p.resetsAt === "number" && Number.isFinite(p.resetsAt) && p.resetsAt > 0
      ? new Date(p.resetsAt * 1000)
      : null;
  return { window: p.rateLimitType ?? "five_hour", resetsAt };
}

/** Call INSTEAD of `markSessionTerminal` while the session is still held (`running`):
 *  `createInboxMessage` needs a live session to block, and IT sets `waiting`, publishes `inbox_ask`
 *  and notifies.
 *
 *  Exhaustion is written BEFORE the decision, so other sessions do not rediscover it one by one,
 *  each at the price of a container start. It is only written when the SDK gave a reset time:
 *  "exhausted without knowing until when" would condemn the account forever, and a state no wake-up
 *  lifts is worse than none. */
export function pauseForQuota(sessionId: string, rej: QuotaRejection): void {
  const run = runAccountOf(sessionId);
  const projectId = run?.projectId;
  const credentialId = run?.credentialId ?? null;
  if (credentialId && rej.resetsAt) recordExhaustion(credentialId, rej.window, rej.resetsAt);

  const accounts = projectId ? credentialsOfProject(projectId) : [];
  const next = projectId
    ? resolveProjectCredential(projectId)
    : { credentialId: null, credentialLabel: null, available: true, retryAt: null };
  const plan = planQuotaPause({
    rejection: rej,
    exhausted: { credentialId, label: accounts.find((a) => a.id === credentialId)?.label ?? null },
    next: {
      credentialId: next.credentialId,
      label: next.credentialLabel,
      available: next.available,
      retryAt: next.retryAt,
    },
    now: Date.now(),
  });

  // In `control_events` because that is where one investigates hours later why a task ran on this
  // account, or slept while another was free. The session already carries the inbox entry.
  logControlEvent(
    "info",
    "quota",
    plan.switchTo
      ? `session ${sessionId} out of quota (${rej.window}): switching to another credential of the project`
      : `session ${sessionId} out of quota (${rej.window}): no other credential available, wake-up ${plan.wakeAt?.toISOString() ?? "manual"}`,
    { sessionId, projectId, window: rej.window, credentialId, switchTo: plan.switchTo },
  );

  createInboxMessage(sessionId, {
    kind: "text",
    body: plan.body,
    impact:
      "Nothing is lost: work pushed to the branch, conversation preserved — the resume picks up exactly where the session stopped.",
    ...(plan.wakeAt ? { wakeAt: plan.wakeAt } : {}),
  });
}

/** Scheduler tick (30 s): wakes pauses whose time has passed. `answeredBy: system` (v26): the resume
 *  prompt never claims a human answered. A failed wake-up (quota still closed, runner full) reopens
 *  the entry (`answerInbox`'s contract): the next tick retries, and a resume dying out of quota again
 *  pauses with the new time. The loop converges instead of burning the next window. */
export function wakeDueQuotaPauses(now = Date.now()): void {
  const due = openInboxWakeups().filter(
    (m) => (m.wakeAt?.getTime() ?? Number.POSITIVE_INFINITY) <= now,
  );
  for (const m of due) {
    void answerInbox(
      m.id,
      // A long run's relaunch uses this same wake-up (10/09), with its own text: the measurement
      // composed by the container that just died, stored in the entry's BODY since no column holds
      // "what to tell the agent at wake-up". Handing it back as is is the only way it learns why it
      // was moved and what it had produced.
      m.reason === WAIT_REASON.turnRelaunch
        ? { text: m.body }
        : // The text no longer promises a reset quota: since v64 a wake-up can also mean another
          // project credential took over. The inbox entry says which; the resume prompt need not
          // repeat it, and above all must not assert the wrong one.
          { text: "You can start again — pick up exactly where you left off." },
      { answeredBy: "system" },
    ).catch((err) => log.warn("wake-up failed", { inboxId: m.id, error: (err as Error).message }));
  }
}
