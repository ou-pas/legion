// Schedule queries. Nothing is decided here; the rules are in `schedules.ts`.
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type ScheduleRow = typeof schema.schedules.$inferSelect;
export type NewSchedule = typeof schema.schedules.$inferInsert;
export type ScheduleRunRow = typeof schema.scheduleRuns.$inferSelect;
export type NewScheduleRun = typeof schema.scheduleRuns.$inferInsert;
export type NewTask = typeof schema.tasks.$inferInsert;

export function scheduleRowsOf(projectId: string): ScheduleRow[] {
  return db.select().from(schema.schedules).where(eq(schema.schedules.projectId, projectId)).all();
}

export function scheduleRow(id: string): ScheduleRow | undefined {
  return db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).get();
}

/** Newest first. */
export function runRowsOf(scheduleId: string, limit: number): ScheduleRunRow[] {
  return db
    .select()
    .from(schema.scheduleRuns)
    .where(eq(schema.scheduleRuns.scheduleId, scheduleId))
    .orderBy(desc(schema.scheduleRuns.firedAt))
    .limit(limit)
    .all();
}

/** Rules whose due time is set and reached at `at`. The verdict (fired, missed, disabled) belongs
 *  to `fireDueSchedules`. */
export function schedulesDueAt(at: Date): ScheduleRow[] {
  return db
    .select()
    .from(schema.schedules)
    .where(and(isNotNull(schema.schedules.nextRunAt), lte(schema.schedules.nextRunAt, at)))
    .all();
}

export function insertSchedule(row: NewSchedule): void {
  db.insert(schema.schedules).values(row).run();
}

/** `next_run_at` included: the caller recomputes it on every write. */
export function saveScheduleDefinition(
  id: string,
  fields: Pick<
    NewSchedule,
    "name" | "cron" | "agentId" | "templateId" | "prompt" | "enabled" | "nextRunAt"
  >,
): void {
  db.update(schema.schedules).set(fields).where(eq(schema.schedules.id, id)).run();
}

export function setNextRun(id: string, nextRunAt: Date | null): void {
  db.update(schema.schedules).set({ nextRunAt }).where(eq(schema.schedules.id, id)).run();
}

export function setLastAndNextRun(id: string, lastRunAt: Date, nextRunAt: Date | null): void {
  db.update(schema.schedules)
    .set({ lastRunAt, nextRunAt })
    .where(eq(schema.schedules.id, id))
    .run();
}

export function deleteRunsOfSchedule(id: string): void {
  db.delete(schema.scheduleRuns).where(eq(schema.scheduleRuns.scheduleId, id)).run();
}

export function deleteScheduleRow(id: string): void {
  db.delete(schema.schedules).where(eq(schema.schedules.id, id)).run();
}

export function insertScheduleRun(row: NewScheduleRun): void {
  db.insert(schema.scheduleRuns).values(row).run();
}

/** The task enters the queue like any other: the pump takes it, with its session cap and preflight. */
export function insertScheduledTask(row: NewTask): void {
  db.insert(schema.tasks).values(row).run();
}
