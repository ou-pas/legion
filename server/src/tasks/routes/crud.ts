// A task's record: what is read, and what makes it disappear (06/09). Database knowledge lives in
// `task-reads-store.ts` and `lifecycle.ts`: this file reads a parameter, calls a named function and
// picks an HTTP status.
import type { Hono } from "hono";
import { parseBody } from "../../http/parse-body.js";
import { deleteTask, taskLiveSessions } from "../../projects/purge.js";
import { wakeWaitersOf } from "../../sessions/wait-for-task.js";
import { archiveDoneTasks } from "../lifecycle.js";
import { archiveDoneBody } from "../schemas.js";
import { taskLinks } from "../task-links.js";
import {
  allSessionRows,
  allTaskRows,
  demoProjectIds,
  findTask,
  taskActivity,
} from "../task-reads-store.js";
import { serializeTask, serializeTaskSummaries } from "../task-serialize.js";

export function registerTaskCrudRoutes(app: Hono): void {
  // Summaries, not records (02/09): this read paints the board, the channels, a chain's flow,
  // never more than three chips per task. `serializeTaskSummaries` drops the brief and criteria;
  // one task's detail is asked through `findTask`, one at a time.
  app.get("/api/tasks", (c) => {
    const tasks = allTaskRows();
    const sessions = allSessionRows();
    return c.json({ tasks: serializeTaskSummaries(tasks, sessions, demoProjectIds()), sessions });
  });

  // A task's full record, brief and criteria included. Separate from the list since the 02/09 cut:
  // the task page is the only one needing the whole text, and asks for it one task at a time rather
  // than making the other 107 carry it.
  app.get("/api/tasks/:id", (c) => {
    const task = findTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    return c.json(serializeTask(task));
  });

  // A task's lineage: where it comes from, what it spawned. Separate from the serialiser, which also
  // serves the board list; see task-links.ts's header.
  app.get("/api/tasks/:id/links", (c) => c.json(taskLinks(c.req.param("id"))));

  app.get("/api/tasks/:id/activity", (c) => c.json(taskActivity(c.req.param("id"))));

  // Deleting a task. Same gap as for projects: nothing allowed it, and archiving is reserved to
  // `done` tasks.
  app.delete("/api/tasks/:id", async (c) => {
    const task = findTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    const live = taskLiveSessions(task.id);
    const [first] = live;
    if (first)
      return c.json(
        { error: `session ${first.status} in flight on this task — stop it first`, live },
        409,
      );
    // v26: before deletion, not after. A session asleep on this task (`wait_for_task`) would
    // otherwise wait for a "done" that never comes. The wake-up is named ("task X was deleted") and
    // needs to read the row while it exists.
    const woken = await wakeWaitersOf(task.id, "deleted");
    const footprint = deleteTask(task.id);
    return c.json({
      ok: true,
      deleted: task.name,
      footprint,
      wokenSessions: woken.map((w) => w.sessionId),
    });
  });

  // Bulk archive: all of a project's (unarchived) done tasks in one click (5b).
  app.post("/api/tasks/archive-done", async (c) => {
    const body = await parseBody(c, archiveDoneBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return c.json({ archived: archiveDoneTasks(body.value.projectId) });
  });
}
