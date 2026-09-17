import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db, schema } from "../shared/db.js";
import {
  approveDod,
  generateDod,
  goalDetail,
  killGoal,
  listGoals,
  pauseGoal,
  resumeGoal,
} from "../goals/goals.js";
import { deleteGoal, goalDeletionPreview } from "./goal-delete.js";
import { editGoal, regenerateGoalDod } from "./goal-edit.js";
import { hasCredential } from "../projects/auth.js";
import { parseBody } from "../http/parse-body.js";
import { fromResult } from "../http/from-result.js";
import { approveGoalBody, createGoalBody, goalFromIssuesBody, goalPatchBody } from "./schemas.js";

export function registerGoalRoutes(app: Hono): void {
  app.get("/api/goals", (c) => c.json(listGoals(c.req.query("projectId") || undefined)));
  app.get("/api/goals/:id", (c) => {
    const g = goalDetail(c.req.param("id"));
    return g ? c.json(g) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/goals", async (c) => {
    const parsed = await parseBody(c, createGoalBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;
    const mock = !hasCredential(body.projectId); // project credential, global env as fallback (auth.ts)
    const goal = {
      id: nanoid(10),
      projectId: body.projectId,
      name: body.name,
      request: body.request,
      allowedAgentIds: JSON.stringify(body.allowedAgentIds ?? []),
      budgetUsd: body.budgetUsd ?? null,
      maxDurationMs: body.maxHours ? Math.round(body.maxHours * 3_600_000) : null,
      maxNoProgress: body.maxNoProgress ?? 3,
      mock,
      createdAt: new Date(),
    };
    db.insert(schema.goals).values(goal).run();
    try {
      const { dod, plan } = await generateDod(goal.id); // draft — nothing runs before human approval
      return c.json({ id: goal.id, dod, plan }, 201);
    } catch (err) {
      return c.json(
        { id: goal.id, dod: [], plan: [], warning: String((err as Error).message) },
        201,
      );
    }
  });

  // The domain decides (goal-edit.ts), the route translates: a refusal arrives named, with its
  // HTTP status, never thrown.
  app.patch("/api/goals/:id", async (c) => {
    const parsed = await parseBody(c, goalPatchBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = await editGoal(c.req.param("id"), parsed.value);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({
      ok: true,
      goal: result.goal,
      changed: result.changed,
      ...(result.dod ? { dod: result.dod, plan: result.plan } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    });
  });

  // Redo the DoD and plan of a `draft` goal: recovery from a generation that failed during a PATCH
  // (see goal-edit.ts's header), without rewriting the request to trigger it.
  app.post("/api/goals/:id/regenerate", async (c) => {
    const result = await regenerateGoalDod(c.req.param("id"));
    return result.ok
      ? c.json({ ok: true, dod: result.dod, plan: result.plan })
      : c.json({ error: result.error }, result.status);
  });

  // No `catch` on these four routes since 06/09: `goals.ts` returns its refusal with its status.
  // The old `catch` flattened them all to 400, so a missing goal, an already launched goal and an
  // empty DoD returned the same code.
  app.post("/api/goals/:id/approve", async (c) => {
    const parsed = await parseBody(c, approveGoalBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return fromResult(c, approveDod(c.req.param("id"), parsed.value.items));
  });

  app.post("/api/goals/:id/pause", (c) => fromResult(c, pauseGoal(c.req.param("id"))));
  app.post("/api/goals/:id/resume", (c) => fromResult(c, resumeGoal(c.req.param("id"))));
  app.post("/api/goals/:id/kill", (c) => fromResult(c, killGoal(c.req.param("id"))));

  // What deleting a goal would destroy, the sessions preventing it, and the tasks outside the goal
  // it would unblock. Shown before confirming; mirrors `GET /api/projects/:id/footprint`, plus the
  // artifacts folder (the one thing no backup recovers).
  app.get("/api/goals/:id/footprint", (c) => {
    const preview = goalDeletionPreview(c.req.param("id"));
    return preview ? c.json(preview) : c.json({ error: "goal not found" }, 404);
  });

  // There used to be no way to delete a goal: one that would never launch stayed on screen forever,
  // and the only recourse was destroying its project. Refusals are named, never a bare no.
  app.delete("/api/goals/:id", (c) => {
    const result = deleteGoal(c.req.param("id"));
    if (!result.ok)
      return c.json(
        { error: result.error, ...(result.live ? { live: result.live } : {}) },
        result.status,
      );
    return c.json({
      ok: true,
      deleted: result.deleted,
      footprint: result.footprint,
      unblocked: result.unblocked,
      closedWaits: result.closedWaits,
    });
  });

  // Issues → goal (batch 3): several Linear issues become one goal with a derived DoD.
  app.post("/api/goals/from-issues", async (c) => {
    const parsed = await parseBody(c, goalFromIssuesBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;
    const request =
      `Work through the following issues (one at a time, each with its PR linked by "Closes"):\n` +
      body.issues.map((i) => `- ${i.identifier}: ${i.title} (${i.url})`).join("\n");
    const mock = !hasCredential(body.projectId); // project credential, global env as fallback (auth.ts)
    const goal = {
      id: nanoid(10),
      projectId: body.projectId,
      name: body.name?.trim() || `${body.issues.length} issues → delivery`,
      request,
      allowedAgentIds: JSON.stringify([]),
      budgetUsd: body.budgetUsd ?? null,
      maxDurationMs: null,
      maxNoProgress: 3,
      mock,
      createdAt: new Date(),
    };
    db.insert(schema.goals).values(goal).run();
    try {
      const { dod, plan } = await generateDod(goal.id);
      return c.json({ id: goal.id, dod, plan }, 201);
    } catch (err) {
      return c.json(
        { id: goal.id, dod: [], plan: [], warning: String((err as Error).message) },
        201,
      );
    }
  });
}
