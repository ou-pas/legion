// What creates a task and what amends it (06/09): composer, creation, PATCH, Kanban drop.
//
// The four bodies go through `schemas.ts` before reaching anything: checking was most missing here,
// with `complexity` and `priority` reaching the database unchecked although they are ENUM columns.
// The rest belongs to `task-create.ts`, `task-patch.ts` and `task-move.ts`; only the HTTP status
// is left here.
import type { Hono } from "hono";
import { parseBody } from "../../http/parse-body.js";
import { listChainLibrary } from "../../chains/catalog.js";
import { classifyTask } from "../task-classify.js";
import { classifyAgentsOf } from "../task-reads-store.js";
import { createTask } from "../task-create.js";
import { applyTaskPatch } from "../task-patch.js";
import { applyTaskMove } from "../task-move.js";
import { serializeTask } from "../task-serialize.js";
import { classifyBody, createTaskBody, moveTaskBody, patchTaskBody } from "../schemas.js";

export function registerTaskEditRoutes(app: Hono): void {
  // Simplified composer (23/08): title + brief are enough, this call proposes agent/chain,
  // complexity, gate, never blocking (task-classify.ts). The front keeps control: this creates
  // nothing, and the settings stay prefillable and overridable.
  app.post("/api/tasks/classify", async (c) => {
    const body = await parseBody(c, classifyBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const { projectId, name, description, forced } = body.value;
    const chains = listChainLibrary().map((ch) => ({
      id: ch.id,
      name: ch.name,
      description: ch.description,
    }));
    return c.json(
      await classifyTask({
        projectId,
        name,
        description: description ?? "",
        agents: classifyAgentsOf(projectId),
        chains,
        ...(forced ? { forced } : {}),
      }),
    );
  });

  app.post("/api/tasks", async (c) => {
    const body = await parseBody(c, createTaskBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const created = createTask(body.value);
    if (!created.ok) return c.json({ error: created.error }, created.status);
    return c.json(serializeTask(created.task), 201);
  });

  // Human transitions only: agents go through /internal with their session token.
  app.patch("/api/tasks/:id", async (c) => {
    const body = await parseBody(c, patchTaskBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const patched = applyTaskPatch(c.req.param("id"), body.value);
    if (!patched.ok)
      return c.json(
        { error: patched.error, ...(patched.live ? { live: patched.live } : {}) },
        patched.status,
      );
    // The re-read row, not `{ok:true}`: the screen that just edited the brief must show what is in
    // the database, not what it thinks it sent.
    return c.json(serializeTask(patched.task));
  });

  // Kanban drag and drop: moves a task to a column (`status`) and a position (`index`, 0-based,
  // among tasks already in that column) in one transaction; see task-move.ts for the ordering
  // strategy (fractional rank, local resequencing when precision runs out). Separate from the
  // generic PATCH: a drop always carries both (column + position), never one without the other,
  // which a partial PATCH expresses poorly.
  app.post("/api/tasks/:id/move", async (c) => {
    const body = await parseBody(c, moveTaskBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const moved = applyTaskMove(c.req.param("id"), body.value);
    if (!moved.ok) return c.json({ error: moved.error }, moved.status);
    return c.json({ task: serializeTask(moved.task), rebalanced: moved.rebalanced });
  });
}
