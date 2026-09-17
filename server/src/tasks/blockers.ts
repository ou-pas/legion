// Blocker links between tasks: the only code writing `task_blockers`.
//
// Why a table (28/08, "decoupe" spec, behaviour 8): a task can be blocked by several tasks (a
// batch's slices all block the Wiki step), and the former single column held only one. The
// refactor went expand → migrate → contract: the table was born next to the column (v44, slice 01),
// every reader moved here (slice 02), then every writer, and the column went (v45, slice 03). A test
// asserts it (`blockers.test.ts`): outside the migrations that added, copied and removed it, nobody
// mentions it any more.
//
// A block is a consumed event, not a recomputed state: the link disappears when the blocker becomes
// done, and a blocker moved back to doing does not recreate it (the column always behaved so, the
// table keeps it). Corollary for readers: one link = blocked, without re-reading the blocker's
// status.
//
// Fifth writer (task "set a dependency from the API"): `POST`/`PATCH /api/tasks`, through
// `task-blocker-edit.ts` for edits. The four others (chain, batch, blocking filing, deletion) build
// links safe by construction; an HTTP caller cannot, hence `validateBlockerLinks` below:
// self-blocking, existence, project, blocker already `done`, cycle, guards no internal writer ever
// needed.
//
// Queries live in `blockers-store.ts`; this file only carries the guards, the cycle walk and the
// release rule.
import {
  blockedAmong,
  candidateTasksByIds,
  deleteBlockersFrom,
  dependentsOf,
  heldBy,
} from "./blockers-store.js";
import { TASK_STATUS } from "./lifecycle.js";

export {
  addBlocker,
  blockedTaskIds,
  blockersByTask,
  blockersOf,
  consumeBlockersOf,
  removeBlocker,
  type BlockerRef,
} from "./blockers-store.js";
export { dependentsOf };

/** A blocker's done (or disappearance): consumes every link where `blockerId` is the blocker, and
 *  returns the tasks it held that nothing holds any more, the ones this done releases. The last
 *  blocker to finish releases, exactly once, in any order. */
export function releaseDependentsOf(blockerId: string): string[] {
  const held = heldBy(blockerId);
  if (held.length === 0) return [];
  deleteBlockersFrom(blockerId);
  const stillHeld = blockedAmong(held);
  return held.filter((id) => !stillHeld.has(id));
}

/** A blocked task does not launch, and the refusal must reach the operator (10/09).
 *
 *  It was a bare `Error` thrown by `runTask`: `knownFailure` (http/errors.ts) only recognises types,
 *  so the screen got "internal error" and the reason stayed in the control plane log. Seen on task
 *  `T6ywbnqS3Y`: five clicks on "resolve conflict" in twenty seconds, five 500s, and the real
 *  sentence (blocked by "…" (later)) nowhere on screen.
 *
 *  409: the current state refuses the gesture, and will until it changes. The message names its
 *  blockers, and the operator reads it. */
export class TaskBlockedError extends Error {
  override readonly name = "TaskBlockedError";
}

/** What must be named to refuse a link, as a 400. */
export type BlockerLinkError = { status: 400; error: string };

/** Validates a set of blockers to set on `taskId` (of project `projectId`) before calling
 *  `addBlocker`; sets nothing itself. Needed since the entry door is no longer only the four
 *  internal writers (which built links safe by construction: a chain instantiates in its own
 *  project, a slice points at a sibling of the same batch) but also `POST`/`PATCH /api/tasks`, where
 *  an external caller can send any id. Returns the first violation, named for a 400, or `null`.
 *
 *  Four rules, in check order (cheapest first):
 *   1. no self-blocking;
 *   2. blockers must exist (the FK would say so too, but as a SQLite error unreadable to an HTTP
 *      caller; here unknown ids are named);
 *   3. same project as the blocked task, or a link would point at a task another project could
 *      delete or that nobody here controls;
 *   4. a blocker already `done` is refused rather than accepted then silently consumed: a link is an
 *      event consumed at the blocker's done (see the file header), so setting one on a finished task
 *      has no event left. Neither a dead link blocking the task forever (the blocker never goes
 *      through `done` again) nor a silent no-op suggesting the dependency was recorded.
 *
 *  Then the cycle, the only rule not readable on one row: A cannot block B if B already blocks A,
 *  directly or through a chain of links. Such a cycle would make both tasks ineligible for the queue
 *  forever (`pumpQueue`/`runTask` filter on `blockedTaskIds` with no way to release them), with no
 *  message saying so. Detected by following `dependentsOf` from `taskId`: if a requested
 *  `blockerId` appears among what already depends (directly or not) on `taskId`, adding it would
 *  close the loop. */
export function validateBlockerLinks(
  taskId: string,
  blockerIds: string[],
  projectId: string,
): BlockerLinkError | null {
  const ids = [...new Set(blockerIds)];
  if (ids.length === 0) return null;
  if (ids.includes(taskId)) return { status: 400, error: "a task cannot block itself" };

  const rows = candidateTasksByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0)
    return { status: 400, error: `blocker(s) not found: ${missing.join(", ")}` };

  const foreign = rows.filter((r) => r.projectId !== projectId);
  if (foreign.length > 0)
    return {
      status: 400,
      error: `blocker(s) from another project: ${foreign.map((r) => `“${r.name}”`).join(", ")}`,
    };

  const done = rows.filter((r) => r.status === TASK_STATUS.done);
  if (done.length > 0)
    return {
      status: 400,
      error: `blocker(s) already done, nothing to hold this back: ${done.map((r) => `“${r.name}”`).join(", ")} — a link only attaches to a task that is not finished yet`,
    };

  const downstream = reachableThroughDependents(taskId);
  const cyclic = ids.find((id) => downstream.has(id));
  if (cyclic) {
    return {
      status: 400,
      error: `cycle: “${byId.get(cyclic)!.name}” already depends (directly or indirectly) on this task — blocking it back would create a cycle`,
    };
  }

  return null;
}

/** Everything depending on `start`, transitively, following `dependentsOf` (the "still holds"
 *  edge). Only used by `validateBlockerLinks`: the graph a new link to `start` must never cross. */
function reachableThroughDependents(start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const next of dependentsOf(cur)) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}
