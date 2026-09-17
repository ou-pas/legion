// Disabling / deleting a runner (04/09). `runners.enabled` used to change only through a manual SQL
// UPDATE, which left `legion-browser-s6PeSEW3Dl` behind when the `local` runner was disabled by hand
// with no cleanup attached. Disabling or deleting now calls `cleanupOrphans` in the same action.
//
// Refused first if a session is still alive on the runner, using `ACTIVE_STATUSES` (waiting/blocked
// included): `runnerId` is fixed at session creation, so a `waiting` session will resume on THIS
// runner. Same list and reason as for agents and tasks.
//
// Cleanup never blocks the action: an unreachable daemon is often the reason for disabling. Its
// failure is reported in the response and `control_events`.
import { cleanupOrphans } from "../infra.js";
import { ACTIVE_STATUSES } from "../../sessions/session-terminal.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { logControlEvent } from "../../events/control-log-store.js";
import { deleteRunnerRow, runnerById, updateRunner } from "../runner-store.js";
import { activeSessionsOnRunner } from "./lifecycle-store.js";

export interface RunnerCleanupOutcome {
  removed: string[];
  errors: string[];
  /** Cleanup not attempted (`process` runner, or unreachable daemon): the reason, never silence. */
  skipped: string | null;
}

export interface LiveSession {
  id: string;
  status: string;
}

export type RunnerLifecycleResult =
  | {
      ok: true;
      runner: { id: string; name: string; enabled: boolean };
      cleanup: RunnerCleanupOutcome;
    }
  | { ok: false; status: 404 | 409; error: string; live?: LiveSession[] };

export type RunnerDeleteResult =
  | { ok: true; runnerId: string; runnerName: string; cleanup: RunnerCleanupOutcome }
  | { ok: false; status: 404 | 409; error: string; live?: LiveSession[] };

/** Sessions still alive on THIS runner, all active statuses (see header). */
export function runnerLiveSessions(runnerId: string): LiveSession[] {
  return activeSessionsOnRunner(runnerId, ACTIVE_STATUSES);
}

/** Only meaningful for a docker runner. A cleanup failure is reported in `skipped`, never
 *  interrupting the calling action. */
async function cleanupIfDocker(runner: {
  id: string;
  kind: string;
}): Promise<RunnerCleanupOutcome> {
  if (runner.kind !== RUNNER_KIND.docker)
    return {
      removed: [],
      errors: [],
      skipped: "process runner: nothing to clean up on the docker side",
    };
  const cleanup = await cleanupOrphans(runner.id);
  if (!cleanup.ok) return { removed: [], errors: [], skipped: cleanup.error };
  return { ...cleanup.value, skipped: null };
}

function cleanupSummary(cleanup: RunnerCleanupOutcome): string {
  if (cleanup.skipped) return `cleanup not attempted (${cleanup.skipped})`;
  if (cleanup.removed.length === 0 && cleanup.errors.length === 0) return "nothing to clean up";
  return `cleanup: ${cleanup.removed.length} removed, ${cleanup.errors.length} failed`;
}

/** Disabling refuses a live session, then cleans THIS runner's containers/networks/volumes.
 *  Re-enabling cleans nothing (`browser-cleanup.ts` already protects every enabled runner). */
export async function setRunnerEnabled(
  runnerId: string,
  enabled: boolean,
): Promise<RunnerLifecycleResult> {
  const runner = runnerById(runnerId);
  if (!runner) return { ok: false, status: 404, error: "runner not found" };

  if (!enabled && runner.enabled) {
    const live = runnerLiveSessions(runnerId);
    if (live.length > 0)
      return {
        ok: false,
        status: 409,
        error: `session ${live[0]!.status} in flight on this runner: disabling it would cut it off without warning — wait for it to finish`,
        live,
      };
  }

  updateRunner(runnerId, { enabled });

  const cleanup: RunnerCleanupOutcome = enabled
    ? { removed: [], errors: [], skipped: "runner re-enabled: nothing to clean up" }
    : await cleanupIfDocker(runner);

  logControlEvent(
    enabled ? "info" : "warn",
    "runner",
    `runner “${runner.name}” ${enabled ? "re-enabled" : "disabled"} — ${cleanupSummary(cleanup)}`,
    { runnerId, enabled, cleanup },
  );

  return { ok: true, runner: { id: runner.id, name: runner.name, enabled }, cleanup };
}

/** Refuses a live session, and also any runner that ever carried a session: `sessions.runner_id`
 *  references it (NOT NULL, no cascade). On purpose: a runner that ran is disabled, not erased with
 *  its history. Deleting only undoes a mistaken declaration. */
export async function deleteRunner(runnerId: string): Promise<RunnerDeleteResult> {
  const runner = runnerById(runnerId);
  if (!runner) return { ok: false, status: 404, error: "runner not found" };

  const live = runnerLiveSessions(runnerId);
  if (live.length > 0)
    return {
      ok: false,
      status: 409,
      error: `session ${live[0]!.status} in flight on this runner: it cannot be deleted before it finishes`,
      live,
    };

  const cleanup = await cleanupIfDocker(runner);

  try {
    deleteRunnerRow(runnerId);
  } catch {
    // FK constraint, translated into a sentence rather than SQLITE_CONSTRAINT on screen.
    return {
      ok: false,
      status: 409,
      error: "this runner already has sessions to its name: it cannot be deleted, only disabled",
    };
  }

  logControlEvent(
    "warn",
    "runner",
    `runner “${runner.name}” deleted — ${cleanupSummary(cleanup)}`,
    { runnerId, cleanup },
  );

  return { ok: true, runnerId: runner.id, runnerName: runner.name, cleanup };
}
