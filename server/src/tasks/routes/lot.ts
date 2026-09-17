// A Breakdown step's batch (06/09): what the operator reads, then the gesture approving it.
//
// Two routes whose whole content lives in `chains/slices.ts`: read the batch file from disk,
// validate it, approve it. They stay under `tasks` because their path is a task's and the task page
// calls them.
import type { Hono } from "hono";
import { approveLot, lotStep, lotView, readLot, validateLot } from "../../chains/slices.js";
import { findTask } from "../task-reads-store.js";

export function registerTaskLotRoutes(app: Hono): void {
  // The batch as it is on disk right now, what the operator reads before approving. Separate from
  // the task serialiser because it touches the disk: the board list serialises dozens of tasks and
  // should not open a file per card. Also returns the faults, so the screen shows a faulty batch
  // with what is wrong rather than a button that will fail.
  app.get("/api/tasks/:id/lot", (c) => {
    const task = findTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    // `approvesLot: false` rather than a 400: the screen asks and cannot know beforehand, since the
    // flag lives in the template, not on the task row. A refusal here would force the page of every
    // chain step in review to handle an expected error as a failure.
    if (!lotStep(task)) return c.json({ approvesLot: false, slices: [], faults: [] });
    const read = readLot(task);
    if (!read.ok) return c.json({ approvesLot: true, slices: [], faults: [read.fault] });
    return c.json({
      approvesLot: true,
      slices: lotView(read.slices),
      faults: validateLot(read.slices),
    });
  });

  // Batch approval, the operator's single gesture (behaviour 5). All or nothing: the slices are
  // born, Wiki waits for all of them, Breakdown finishes, or nothing moves.
  app.post("/api/tasks/:id/approve-lot", (c) => {
    const result = approveLot(c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error, faults: result.faults }, result.status);
    return c.json({ created: result.created });
  });
}
