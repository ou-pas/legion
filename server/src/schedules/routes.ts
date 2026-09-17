// The routes `web/src/api/schedules.ts` had called since PR #50. The contract comes from the
// screen, which existed first: dates in milliseconds, a detail embedding its last ten runs, a
// delete returning `{ ok: true }`.
import type { Hono } from "hono";
import { db, schema } from "../shared/db.js";
import { eq } from "drizzle-orm";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listRuns,
  listSchedules,
  toDto,
  updateSchedule,
  validateSchedule,
  type Validated,
} from "./schedules.js";

export function registerScheduleRoutes(app: Hono): void {
  app.get("/api/schedules", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    return c.json(listSchedules(projectId));
  });

  // The detail embeds its runs: two round trips for one card is a card that flickers.
  app.get("/api/schedules/:id", (c) => {
    const row = getSchedule(c.req.param("id"));
    if (!row) return c.json({ error: "schedule not found" }, 404);
    return c.json({ ...toDto(row), runs: listRuns(row.id, 10) });
  });

  app.get("/api/schedules/:id/runs", (c) => {
    const row = getSchedule(c.req.param("id"));
    if (!row) return c.json({ error: "schedule not found" }, 404);
    const raw = Number(c.req.query("limit") ?? 10);
    return c.json(listRuns(row.id, Number.isFinite(raw) ? raw : 10));
  });

  app.post("/api/schedules", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "JSON body expected" }, 400);
    const projectId = (body as { projectId?: unknown }).projectId;
    if (typeof projectId !== "string" || !projectId)
      return c.json({ error: "projectId required" }, 400);
    if (!db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())
      return c.json({ error: "project not found" }, 404);

    const v = validateSchedule(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    // The agent is checked here, not in the pure validation: it is the only rule needing the
    // database, and keeping it out leaves `validateSchedule` testable without one.
    if (
      v.value.agentId &&
      !db.select().from(schema.agents).where(eq(schema.agents.id, v.value.agentId)).get()
    )
      return c.json({ error: "agent not found" }, 404);
    return c.json(createSchedule(projectId, v.value), 201);
  });

  app.patch("/api/schedules/:id", async (c) => {
    const row = getSchedule(c.req.param("id"));
    if (!row) return c.json({ error: "schedule not found" }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "JSON body expected" }, 400);

    // The existing row is the base: a PATCH carrying only `enabled` must not erase the cron.
    const existing: Validated = {
      name: row.name,
      cron: row.cron,
      agentId: row.agentId,
      templateId: row.templateId,
      prompt: row.prompt,
      enabled: row.enabled,
    };
    const v = validateSchedule(body, existing);
    if (!v.ok) return c.json({ error: v.error }, 400);
    if (
      v.value.agentId &&
      !db.select().from(schema.agents).where(eq(schema.agents.id, v.value.agentId)).get()
    )
      return c.json({ error: "agent not found" }, 404);
    return c.json(updateSchedule(row.id, v.value));
  });

  app.delete("/api/schedules/:id", (c) => {
    const row = getSchedule(c.req.param("id"));
    if (!row) return c.json({ error: "schedule not found" }, 404);
    deleteSchedule(row.id);
    return c.json({ ok: true });
  });
}
