// The tasks domain assembler (06/09). It carries no route itself.
//
// This file used to be 491 lines in one function: thirteen direct `db` calls, six request bodies
// nobody checked, and no test; the routes could only be exercised by mounting a Hono app. The split
// follows what routes do, not their HTTP verb: read a record, amend it, set it moving, serve its
// files, approve its batch.
//
// Registration order matters: Hono follows declaration order, and `/api/tasks/archive-done` (in
// `crud.ts`) must stay distinct from `/api/tasks/:id`. The paths do not overlap today; they would if
// a `POST /api/tasks/:id` ever appeared, and that is what would need re-reading.
import type { Hono } from "hono";
import { registerTaskArtifactRoutes } from "./artifacts.js";
import { registerTaskCrudRoutes } from "./crud.js";
import { registerTaskEditRoutes } from "./edit.js";
import { registerTaskLotRoutes } from "./lot.js";
import { registerTaskRunRoutes } from "./run.js";

export function registerTaskRoutes(app: Hono): void {
  registerTaskCrudRoutes(app);
  registerTaskEditRoutes(app);
  registerTaskRunRoutes(app);
  registerTaskArtifactRoutes(app);
  registerTaskLotRoutes(app);
}
