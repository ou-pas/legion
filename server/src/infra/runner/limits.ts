// A runner's concurrent session cap (26/08, operator's request: raise it to 6, and make it
// configurable). It was seeded at 3 and changing it meant a manual SQLite UPDATE.
//
// Two similar status lists not to confuse: `ACTIVE_STATUSES` (session-terminal.ts) answers "is this
// session still working" and includes `waiting`. The cap counts sessions that OCCUPY A SLOT, i.e.
// have a container: an inbox pause has none and uses no RAM or CPU.
//
// It lives here so the screen shows THE SAME count the selector decides on; "2 of 6" while the
// queue refuses to launch would be worse than no screen.
import { runnerById, updateRunner } from "../runner-store.js";
import { sessionCountsByRunner } from "./limits-store.js";
// Refusals carry their status since 06/09 (the route used to sniff the message for 404 vs 400).
// Returned, not thrown with `http/errors.ts`: importing it here closes a cycle (limits → errors →
// chains/catalog → templates → sessions/runner/manager → limits) that `make arch` refuses.
import { done, refuse, type Result } from "../../http/from-result.js";

/** Statuses holding a container, hence a slot. Used by `pickRunnerRow` to count slots and by
 *  `recoverOrphanSessions` at boot to know which sessions should have a container: same property,
 *  one list. */
export const OCCUPYING_STATUSES = ["starting", "running", "committing"] as const;

/** Zero would be a roundabout way to disable the runner; `enabled` exists for that. */
export const CONCURRENCY_MIN = 1;
/** Each slot is a container with a repo clone and a Claude session; beyond about fifteen on a
 *  desktop it is an outage. The number is arbitrary, having a bound is not: a 60 typed for a 6. */
export const CONCURRENCY_MAX = 16;

/** Per-session RAM. The floor is what the runtime alone needs; the ceiling is a typo guard. */
export const MEMORY_MIN_MB = 512;
export const MEMORY_MAX_MB = 32_768;
export const CPUS_MIN = 0.25;
export const CPUS_MAX = 16;

export interface SessionResources {
  memoryMb: number;
  cpus: number;
}

/** What Docker receives for a session on this runner; `docker.ts` applies, it does not decide. */
export function runnerResources(row: { memoryMb: number; cpus: number }): SessionResources {
  return { memoryMb: row.memoryMb, cpus: row.cpus };
}

export interface RunnerCapacity {
  runnerId: string;
  runnerName: string;
  maxConcurrentSessions: number;
  /** Slots occupied NOW, counted as the selector counts them. */
  running: number;
}

/** Occupied slots per runner, in one query. */
export function runnerLoad(): Map<string, number> {
  return sessionCountsByRunner(OCCUPYING_STATUSES);
}

/** Running sessions are unchanged: container limits are fixed at creation, and changing them would
 *  mean a restart, losing work. Applies to the next sessions; the screen says so. */
export function setRunnerResources(
  runnerId: string,
  patch: { memoryMb?: unknown; cpus?: unknown },
): Result<RunnerCapacity> {
  const runner = runnerById(runnerId);
  if (!runner) return refuse(404, "runner not found");
  const set: { memoryMb?: number; cpus?: number } = {};
  if (patch.memoryMb !== undefined) {
    const mb = Math.round(Number(patch.memoryMb));
    if (!Number.isFinite(mb) || mb < MEMORY_MIN_MB || mb > MEMORY_MAX_MB)
      return refuse(400, `memory expected: between ${MEMORY_MIN_MB} and ${MEMORY_MAX_MB} MB`);
    set.memoryMb = mb;
  }
  if (patch.cpus !== undefined) {
    const c = Number(patch.cpus);
    if (!Number.isFinite(c) || c < CPUS_MIN || c > CPUS_MAX)
      return refuse(400, `CPUs expected: between ${CPUS_MIN} and ${CPUS_MAX}`);
    // Two decimals: nobody tunes a container to the thousandth.
    set.cpus = Math.round(c * 100) / 100;
  }
  if (Object.keys(set).length === 0) return refuse(400, "nothing to change");
  updateRunner(runnerId, set);
  const after = runnerById(runnerId)!;
  return done({
    runnerId: after.id,
    runnerName: after.name,
    maxConcurrentSessions: after.maxConcurrentSessions,
    running: runnerLoad().get(after.id) ?? 0,
  });
}

/** Lowering the cap below the current load is allowed and kills nothing: running sessions finish,
 *  the queue just stops launching. Refusing would lock the operator out of their own machine;
 *  killing containers would silently lose work. */
export function setRunnerConcurrency(runnerId: string, value: unknown): Result<RunnerCapacity> {
  const runner = runnerById(runnerId);
  if (!runner) return refuse(404, "runner not found");
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(n) || n < CONCURRENCY_MIN || n > CONCURRENCY_MAX)
    return refuse(
      400,
      `cap expected: an integer between ${CONCURRENCY_MIN} and ${CONCURRENCY_MAX}`,
    );
  updateRunner(runnerId, { maxConcurrentSessions: n });
  return done({
    runnerId: runner.id,
    runnerName: runner.name,
    maxConcurrentSessions: n,
    running: runnerLoad().get(runner.id) ?? 0,
  });
}
