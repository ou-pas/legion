// Graceful update: suspend, update, resume (08/09, operator's request: the session guard refused
// the update almost every day, three times on 08/09 alone).
//
// What is protected is the turn in flight. Containers survive the update; but in the runtime only
// `/events` has a numbered, acknowledged queue, and `/fs`, `/task`, `/inbox` calls have no replay.
// During `up.sh --build` an `fs_write` or `inbox_ask` returns a tool error to the model. The final
// report is covered separately by `flushOutbox`'s replay.
//
// No new mechanism, like `operator-pause.ts`: the requested pause sets the flag, the runtime honours
// it at a turn boundary, pushes and exits; answering the inbox entry resumes the session. This adds
// only a reason (which ones to wake) and a lock (so the queue does not restart what is being
// stopped).
import { createLogger } from "../shared/log.js";
import { answerInbox } from "../inbox/inbox.js";
import { clearPauseRequest, requestPause } from "../sessions/operator-pause.js";
import { OCCUPYING_STATUSES } from "../infra/runner/limits.js";
import { markPauseAsUpdatePause, occupyingSessionIds, openUpdatePauses } from "./updates-store.js";

const log = createLogger("update");

/** The lock, in memory on purpose.
 *
 *  `runLifecycle` calls `pumpQueue()` in its `finally` on every exit path, pause included, so each
 *  suspended session frees a slot and starts the next: without this lock the window never converges.
 *
 *  In memory because the window dies with the process being replaced; a persisted flag would
 *  outlive what it guarded. */
let suspending = false;

/** Named rather than silent: a human click must read a sentence, and `pumpQueue` requeues the task
 *  on its `.catch`. */
export function updateSuspensionRefusal(): string | null {
  return suspending
    ? "an update is being prepared: sessions are being suspended, nothing new starts"
    : null;
}

/** Exactly what `versionState` counts, or guard and screen would disagree. */
function activeSessionIds(): string[] {
  return occupyingSessionIds(OCCUPYING_STATUSES);
}

export type Suspension = { ok: true; suspended: string[] } | { ok: false; stillRunning: string[] };

/**
 * Asks every active session to pause and waits until none remain.
 *
 * A loop, not one pass: `pauseRefusal` refuses `starting` (no container yet) and `committing` (a
 * push in progress), so we ask again each round.
 *
 * Active sessions are counted, not pauses obtained: one finishing on its own also counts; zero in
 * flight is the goal.
 *
 * On failure the flags are cleared, or a refused update would leave the whole fleet set to stop at
 * its next turn boundary, with inbox entries the operator never asked for.
 */
export async function suspendActiveSessions(
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<Suspension> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const pollMs = opts.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  const asked = new Set<string>();
  suspending = true;
  try {
    for (;;) {
      const active = activeSessionIds();
      if (active.length === 0) return { ok: true, suspended: [...asked] };
      for (const id of active) {
        // Refused `starting`/`committing` are retried next round. `asked` keeps only accepted
        // requests, so only those flags are cleared.
        if (!requestPause(id)) asked.add(id);
      }
      if (Date.now() >= deadline) {
        for (const id of asked) clearPauseRequest(id);
        return { ok: false, stillRunning: active };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } finally {
    suspending = false;
  }
}

/** Marks the suspended sessions' inbox entries so resume knows which to wake. After the fact:
 *  `pauseForOperator` creates the entry without knowing why, and carrying the reason through the
 *  `sessions` table into the runner would be a lot of plumbing for one mark set here. */
export function markSuspendedByUpdate(sessionIds: string[]): number {
  let marked = 0;
  for (const sessionId of sessionIds) marked += markPauseAsUpdatePause(sessionId);
  return marked;
}

/**
 * Resumes what an update put to sleep, from the 30-second tick like `wakeDueQuotaPauses`: it answers
 * the entry and `answerInbox` resumes the session, the usual path. Only open entries with
 * `update-pause` wake; the operator's own pauses keep `operator-pause`.
 *
 * Not at server start, the least intuitive point: `updaterScript` rebuilds fleet images AFTER
 * `up.sh`, two to four minutes per machine, while the new control plane is up and `image-session`
 * is still the old one. Resuming then would run containers on a stale payload (the 04/09 outage in
 * `docker-update.ts`). `updateInFlight()` covers the whole script and frees itself if the updater
 * dies.
 *
 * A failed resume is not lost: `answerInbox` reopens the entry on exception, and the next tick
 * retries.
 */
export async function resumeUpdatePauses(inFlight: () => Promise<boolean>): Promise<number> {
  if (await inFlight()) return 0;
  const due = openUpdatePauses();
  for (const m of due) {
    void answerInbox(
      m.id,
      { text: "The update is finished. Pick up exactly where you left off." },
      { answeredBy: "system" },
    ).catch((err) =>
      log.info("resume after update postponed", {
        inboxId: m.id,
        raison: String((err as Error)?.message ?? err),
      }),
    );
  }
  if (due.length) log.info(`${due.length} session(s) resumed after the update`);
  return due.length;
}
