// Scheduled tasks: the rule, its runs, and what happens when one is missed. Three decisions.
//
// A missed due time is not caught up. The control plane runs on a desktop machine closed at night;
// catching up on wake would fire the whole night's runs at once on a database and repositories
// that have moved, and "run now what was meant for 3:00" is almost always wrong. We write a
// `skipped-missed` row and restart from the next one; the screen says so.
//
// Every due time leaves a trace, even when it produces nothing. Otherwise "it did not run last
// night" has no answer: a bad cron, a stopped server and a deleted agent look the same.
//
// Advancing `nextRunAt` is unconditional, even when creation fails. A due time left in the past
// would retry every thirty seconds forever, writing an error row each time.
import { nanoid } from "nanoid";
import { nextRunOf, parseCron } from "./cron.js";
import { logControlEvent } from "../events/control-log-store.js";
import {
  deleteRunsOfSchedule,
  deleteScheduleRow,
  insertSchedule,
  insertScheduledTask,
  insertScheduleRun,
  runRowsOf,
  saveScheduleDefinition,
  scheduleRow,
  scheduleRowsOf,
  schedulesDueAt,
  setLastAndNextRun,
  setNextRun,
} from "./schedules-store.js";
import type { ScheduleRow } from "./schedules-store.js";
import { createLogger } from "../shared/log.js";

// Each due time (missed, created, failed) goes to `control_events` below: that is the record we
// read back. This logger only carries the ticker's safety net.
const log = createLogger("schedule");
import { TASK_STATUS } from "../tasks/lifecycle.js";
import type { ScheduleOutcome } from "./schedule-enums.js";
import type { Result } from "../http/from-result.js";
// Static since 06/09: the `SessionResumer` port broke the cycle a dynamic `import()` used to hide.
// `chains/` still knows nothing of schedules.
import { instantiateTemplate } from "../chains/templates.js";

/** Beyond this delay the due time is missed. Ten ticks: a busy server or a slow migration must not
 *  turn a legitimate run into a miss, but five minutes late no longer makes sense. */
export const MISS_AFTER_MS = 5 * 60_000;

export type { ScheduleRow };

export interface ScheduleDto {
  id: string;
  projectId: string;
  name: string;
  cron: string;
  agentId: string | null;
  templateId: string | null;
  prompt: string | null;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
}

/** Dates in milliseconds, as `web/src/api/schedules.ts` expects. */
export function toDto(r: ScheduleRow): ScheduleDto {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    cron: r.cron,
    agentId: r.agentId,
    templateId: r.templateId,
    prompt: r.prompt,
    enabled: r.enabled,
    lastRunAt: r.lastRunAt?.getTime() ?? null,
    nextRunAt: r.nextRunAt?.getTime() ?? null,
    createdAt: r.createdAt.getTime(),
  };
}

export interface ScheduleInput {
  projectId?: unknown;
  name?: unknown;
  cron?: unknown;
  agentId?: unknown;
  templateId?: unknown;
  prompt?: unknown;
  enabled?: unknown;
}

export interface Validated {
  name: string;
  cron: string;
  agentId: string | null;
  templateId: string | null;
  prompt: string | null;
  enabled: boolean;
}

/**
 * Pure on purpose: the domain's door, tested without a database.
 *
 * The target is exclusive: a task for an agent, or a chain run. Accepting both would make the tick
 * choose, and an ambiguous rule would run something other than what its author believed.
 */
export function validateSchedule(
  body: ScheduleInput,
  existing?: Validated,
): { ok: true; value: Validated } | { ok: false; error: string } {
  const name = (typeof body.name === "string" ? body.name : (existing?.name ?? "")).trim();
  if (!name) return { ok: false, error: "name required" };
  if (name.length > 120)
    return { ok: false, error: `name too long (${name.length} characters, maximum 120)` };

  const cron = (typeof body.cron === "string" ? body.cron : (existing?.cron ?? "")).trim();
  if (!cron) return { ok: false, error: "cron expression required" };
  if (!parseCron(cron))
    return {
      ok: false,
      error: `“${cron}” is not a five-field UTC cron expression (minute hour day month day-of-week)`,
    };

  const target = validateTarget(body, existing);
  if (!target.ok) return target;

  const enabled = typeof body.enabled === "boolean" ? body.enabled : (existing?.enabled ?? true);
  return { ok: true, value: { name, cron, ...target.value, enabled } };
}

type Target = Pick<Validated, "agentId" | "templateId" | "prompt">;

/** An agent OR a chain, never both, never neither; a chain without a request has nothing to
 *  instantiate. A field absent from the body keeps the existing value; `null` clears it. */
function validateTarget(
  body: ScheduleInput,
  existing?: Validated,
): { ok: true; value: Target } | { ok: false; error: string } {
  const str = (v: unknown, fb: string | null): string | null => {
    if (v === undefined) return fb;
    if (v === null) return null;
    if (typeof v !== "string") return null;
    return v.trim() || null;
  };
  const agentId = str(body.agentId, existing?.agentId ?? null);
  const templateId = str(body.templateId, existing?.templateId ?? null);
  const prompt = str(body.prompt, existing?.prompt ?? null);

  if (agentId && templateId)
    return { ok: false, error: "a schedule targets ONE agent or ONE chain, not both" };
  if (!agentId && !templateId) return { ok: false, error: "a schedule needs an agent or a chain" };
  if (templateId && !prompt)
    return { ok: false, error: "a scheduled chain needs a request (prompt)" };
  return { ok: true, value: { agentId, templateId, prompt } };
}

/** `null` when disabled: the tick reads `next_run_at`, so disabling must clear it, not just set a
 *  flag someone must remember to check. */
function due(v: Validated, fromMs: number): Date | null {
  if (!v.enabled) return null;
  const next = nextRunOf(v.cron, fromMs);
  return next === null ? null : new Date(next);
}

export function listSchedules(projectId: string): ScheduleDto[] {
  return scheduleRowsOf(projectId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toDto);
}

export function getSchedule(id: string): ScheduleRow | undefined {
  return scheduleRow(id);
}

export interface ScheduleRunDto {
  id: string;
  scheduleId: string;
  firedAt: number;
  outcome: ScheduleOutcome;
  taskId: string | null;
  reason: string | null;
}

export function listRuns(scheduleId: string, limit = 10): ScheduleRunDto[] {
  return runRowsOf(scheduleId, Math.min(Math.max(1, limit), 100)).map((r) => ({
    id: r.id,
    scheduleId: r.scheduleId,
    firedAt: r.firedAt.getTime(),
    outcome: r.outcome,
    taskId: r.taskId,
    reason: r.reason,
  }));
}

export function createSchedule(projectId: string, v: Validated, now = new Date()): ScheduleDto {
  const row = {
    id: nanoid(10),
    projectId,
    name: v.name,
    cron: v.cron,
    agentId: v.agentId,
    templateId: v.templateId,
    prompt: v.prompt,
    enabled: v.enabled,
    lastRunAt: null,
    nextRunAt: due(v, now.getTime()),
    createdAt: now,
  };
  insertSchedule(row);
  return toDto(scheduleRow(row.id)!);
}

export function updateSchedule(id: string, v: Validated, now = new Date()): ScheduleDto {
  saveScheduleDefinition(id, {
    name: v.name,
    cron: v.cron,
    agentId: v.agentId,
    templateId: v.templateId,
    prompt: v.prompt,
    enabled: v.enabled,
    // Recomputed on every write: changing the cron without it would fire once more at the old
    // time, the kind of shift that takes a week to understand.
    nextRunAt: due(v, now.getTime()),
  });
  return toDto(scheduleRow(id)!);
}

/** The trace goes with the rule: orphan history attaches to nothing. */
export function deleteSchedule(id: string): void {
  deleteRunsOfSchedule(id);
  deleteScheduleRow(id);
}

/** `taskId` and `reason` are exclusive: a created task has no reason, a refusal has no task. */
function trace(run: {
  scheduleId: string;
  firedAt: Date;
  outcome: ScheduleRunDto["outcome"];
  taskId?: string;
  reason?: string;
}): void {
  insertScheduleRun({
    id: nanoid(10),
    scheduleId: run.scheduleId,
    firedAt: run.firedAt,
    outcome: run.outcome,
    taskId: run.taskId ?? null,
    reason: run.reason ?? null,
  });
}

export interface FireDeps {
  /** Injected so the tick is tested without running an agent or touching Docker. */
  createTask: (s: ScheduleRow, at: Date) => string;
}

/** A due time produces a `todo` task assigned to the agent, which the pump takes like any other.
 *  No launch path of its own: a schedule queues work and inherits the session cap, priority and
 *  preflight refusal for free.
 *
 *  `instantiate` is passed by the caller (`instantiateTemplate` in production) so both paths are
 *  testable. */
export function makeCreateTask(
  instantiate: (
    templateId: string,
    request: string,
  ) => Result<{ runId: string; taskIds: string[] }>,
): FireDeps["createTask"] {
  return (s, at) => {
    if (s.templateId) {
      // The chain's refusal becomes an exception here and only here: nobody listens to a due
      // time, so its only recipient is the tick's log below.
      const chain = instantiate(s.templateId, s.prompt ?? s.name);
      if (!chain.ok) throw new Error(chain.error);
      const first = chain.value.taskIds[0];
      if (!first) throw new Error("the chain produced no step");
      return first;
    }
    const id = nanoid(10);
    insertScheduledTask({
      id,
      projectId: s.projectId,
      name: s.name,
      description: s.prompt ?? "",
      status: TASK_STATUS.todo,
      boardOrder: at.getTime(),
      assigneeAgentId: s.agentId,
      createdAt: at,
      updatedAt: at,
    });
    return id;
  };
}

/** Every reached due time, in order. Returns the number of trace rows written; zero is normal. */
export function fireDueSchedules(nowMs: number, deps: FireDeps): number {
  const rows = schedulesDueAt(new Date(nowMs)).sort(
    (a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime(),
  );

  let written = 0;
  for (const s of rows) {
    const firedAt = s.nextRunAt!;
    const after = nextRunOf(s.cron, nowMs);
    const nextRunAt = s.enabled && after !== null ? new Date(after) : null;

    if (!s.enabled) {
      // Disabled between computing and ticking: the due time existed and is not honoured, which is
      // information, not silence.
      trace({ scheduleId: s.id, firedAt, outcome: "skipped-disabled" });
      setNextRun(s.id, null);
      written++;
      continue;
    }

    if (nowMs - firedAt.getTime() > MISS_AFTER_MS) {
      trace({ scheduleId: s.id, firedAt, outcome: "skipped-missed" });
      setNextRun(s.id, nextRunAt);
      logControlEvent(
        "info",
        "schedule",
        `missed due time for “${s.name}” (scheduled ${firedAt.toISOString()})`,
        { scheduleId: s.id },
      );
      written++;
      continue;
    }

    try {
      const taskId = deps.createTask(s, new Date(nowMs));
      trace({ scheduleId: s.id, firedAt, outcome: "task-created", taskId });
      setLastAndNextRun(s.id, new Date(nowMs), nextRunAt);
      logControlEvent("info", "schedule", `“${s.name}” created task ${taskId}`, {
        scheduleId: s.id,
        taskId,
      });
    } catch (err) {
      const reason = String((err as Error)?.message ?? err).slice(0, 500);
      trace({ scheduleId: s.id, firedAt, outcome: "error", reason });
      // Advance anyway: a rule failing every thirty seconds would flood the trace with one message.
      setNextRun(s.id, nextRunAt);
      logControlEvent("error", "schedule", `“${s.name}” failed: ${reason}`, {
        scheduleId: s.id,
      });
    }
    written++;
  }
  return written;
}

/** Separate from the chains' tick: `chains/` need not know schedules, and a failure here must not
 *  take the queue down. */
export function startScheduleTicker(): void {
  setInterval(() => {
    // One exploding due time must not stop the ticker for the next ones.
    try {
      fireDueSchedules(Date.now(), { createTask: makeCreateTask(instantiateTemplate) });
    } catch (err: unknown) {
      log.warn("tick failed", { error: (err as Error).message });
    }
  }, 30_000).unref();
}
