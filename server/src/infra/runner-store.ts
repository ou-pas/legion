// The `runners` registry store, read and written by everything that drives a machine.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { RUNNER_KIND } from "../shared/enums.js";

export type RunnerRow = typeof schema.runners.$inferSelect;
export type RunnerPatch = Partial<typeof schema.runners.$inferInsert>;

export function allRunners(): RunnerRow[] {
  return db.select().from(schema.runners).all();
}

export function runnerById(runnerId: string): RunnerRow | undefined {
  return db.select().from(schema.runners).where(eq(schema.runners.id, runnerId)).get();
}

export function runnerByName(name: string): RunnerRow | undefined {
  return db.select().from(schema.runners).where(eq(schema.runners.name, name)).get();
}

export function insertRunner(row: typeof schema.runners.$inferInsert): void {
  db.insert(schema.runners).values(row).run();
}

export function updateRunner(runnerId: string, set: RunnerPatch): void {
  db.update(schema.runners).set(set).where(eq(schema.runners.id, runnerId)).run();
}

export function deleteRunnerRow(runnerId: string): void {
  db.delete(schema.runners).where(eq(schema.runners.id, runnerId)).run();
}

/** Enabled runners of any kind: what the probe (`probe.ts`) queries. */
export function enabledRunners(): RunnerRow[] {
  return db.select().from(schema.runners).where(eq(schema.runners.enabled, true)).all();
}

/** id → enabled for ALL runners: `browser-cleanup.ts` checks whether a browser service's runner
 *  still exists and is enabled. */
export function runnerEnabledMap(): Map<string, boolean> {
  return new Map(allRunners().map((r) => [r.id, r.enabled]));
}

/** Minimal reference of each DOCKER runner, enough to query it. */
export function dockerRunnerRefs(): { id: string; name: string; dockerHost: string | null }[] {
  return db
    .select({
      id: schema.runners.id,
      name: schema.runners.name,
      dockerHost: schema.runners.dockerHost,
    })
    .from(schema.runners)
    .where(eq(schema.runners.kind, RUNNER_KIND.docker))
    .all();
}
