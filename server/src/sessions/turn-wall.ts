// The hard turn wall, when it is reached anyway (10/09).
//
// The SDK's `maxTurns: 400` cuts the session dead (`error_max_turns`), and everything unpushed dies
// with the container. It happened on 25/08 on the Channels view under the old 200 ceiling: 201
// turns, $32.08, cut the second the agent was writing its final commit.
//
// Since the automatic relaunch, this should no longer happen: a moving session restarts before the
// wall (`turn-relaunch.ts`), a stuck one stops before it (`pause-guards.mts`). Seeing it means one
// path failed (relaunch refused, inbox unreachable, or a single turn longer than the 25-turn
// margin). "Should no longer happen" is exactly the kind of fact that must SHOW.
//
// Not in `turn-relaunch.ts` because the relaunch route needs `authSession`, which lives in
// `internal-routes.ts`, which needs this check. Two modules break the cycle: one ACTS, the other
// OBSERVES.
import { type schema } from "../shared/db.js";
import { logControlEvent } from "../events/control-log-store.js";

type SessionRow = typeof schema.sessions.$inferSelect;

/** The subtype the SDK sets on its `result` when IT cut. Written once here: the runner knows it on
 *  its side (`turn-outcome.mts`), but the two halves share no type, only a string. */
const SDK_MAX_TURNS_SUBTYPE = "error_max_turns";

/** Call on EVERY runtime `result`. The filter is here, not in the route: a route does not know what
 *  a result subtype means, and teaching it would put the rule in the translator.
 *
 *  `warn`, not `info`: not a normal case, a case to understand. */
export function noteTurnWall(session: Pick<SessionRow, "id" | "taskId">, payload: unknown): void {
  const p = (payload ?? {}) as { subtype?: unknown; numTurns?: unknown };
  if (p.subtype !== SDK_MAX_TURNS_SUBTYPE) return;
  logControlEvent(
    "warn",
    "turns",
    `session ${session.id} cut by the hard SDK wall (${String(p.numTurns ?? "?")} turns): ` +
      `the automatic restart did not happen`,
    { sessionId: session.id, taskId: session.taskId, numTurns: p.numTurns ?? null },
  );
}
