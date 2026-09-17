// What crosses a boundary unchecked (05/09). Four leaks, one per boundary:
//   · `c.req.json<Body>()`: the generic declares a shape instead of checking it; the body comes
//     from the network and nobody validates.
//   · `insert({ ...body })` in a route: client input enters the database with nobody saying which
//     fields it may write.
//   · dynamic `import("./…")`: a dependency in no graph, so neither dependency-cruiser nor `tsc`
//     counts it as a cycle.
//   · a session status written by hand instead of from the enum: one more status and every string
//     in the repo must be found.
import { describe, it } from "node:test";
import { mustBeZero, ratchet } from "./ratchet.js";

describe("boundaries leak no more than yesterday", () => {
  it("no new request body accepted without validation", () => {
    ratchet("unvalidatedBody", "occurrences");
  });

  // Absolute threshold (05/09): the last case, `internal-routes.ts` spreading `{ ...body }` into
  // `createInboxMessage`, fell in audit wave 1 (an agent could slip in `reason`, `wakeAt`,
  // `waitForTaskId` and silence the notification). A body spread in a route is always that hole.
  it("no request body spread into a route call", () => {
    mustBeZero(
      "bodySpreadInRoute",
      "a body received from the network enters a service with nobody saying which fields it may set",
    );
  });

  it("no new internal dynamic import in the server", () => {
    ratchet("dynamicImportInternal", "occurrences");
  });

  it("no new session status written by hand instead of the enum", () => {
    ratchet("statusLiterals", "occurrences");
  });

  // Absolute threshold (06/09), at zero since the transition table was born (`TASK_MOVE`,
  // tasks/lifecycle.ts). Six files outside `tasks/` wrote `tasks.status` directly, each with its own
  // `WHERE`, and nothing said those filters had to agree. A status rule living in a `WHERE` can only
  // be read by rereading the whole repo.
  //
  // Writes inside `tasks/` are not counted: the aggregate may write its own column. Remaining debt
  // there: `task-patch.ts`, whose `set` is conditional and does not go through the table yet.
  it("no task status write outside `tasks/`", () => {
    mustBeZero(
      "taskStatusWritesOutsideTasks",
      "a task status is written through the transition table (`TASK_MOVE` / `decidedMove` + `applyTaskTransition`, tasks/lifecycle.ts), never by a local `update` carrying its own rule",
    );
  });
});
