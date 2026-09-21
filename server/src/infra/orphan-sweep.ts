// The orphan cleanup on a timer (21/09): the button in System → Runners, run by itself. Safe on a
// clock because `cleanupOrphans` asks the database, and a session is inserted with its runner before
// anything exists on the Docker side (`insertSession`): a session starting is never an orphan.
import { createLogger } from "../shared/log.js";
import { logControlEvent } from "../events/control-log-store.js";
import { RUNNER_KIND } from "../shared/enums.js";
import { cleanupOrphans } from "./infra.js";
import { allRunners } from "./runner-store.js";

const log = createLogger("orphan-sweep");
const SWEEP_PERIOD_MS = 15 * 60_000;

/** One pass over the enabled docker runners. Disabled ones are cleaned when disabled
 *  (`runner/lifecycle.ts`), and probing a sleeping machine every pass would only time out. */
export async function sweepOrphans(cleanup: typeof cleanupOrphans = cleanupOrphans): Promise<void> {
  const runners = allRunners().filter((r) => r.kind === RUNNER_KIND.docker && r.enabled);
  for (const runner of runners) {
    const result = await cleanup(runner.id);
    // An unreachable daemon is the probe's business: it already reports it.
    if (!result.ok) continue;
    const { removed, errors } = result.value;
    if (removed.length === 0 && errors.length === 0) continue;
    logControlEvent(
      errors.length ? "warn" : "info",
      "infra",
      `orphan sweep on “${runner.name}”: ${removed.length} removed, ${errors.length} failed`,
      { runnerId: runner.id, removed, errors },
    );
  }
}

export function startOrphanSweep(): void {
  setInterval(() => {
    void sweepOrphans().catch((e: unknown) =>
      log.warn("orphan sweep failed", { error: String((e as Error)?.message ?? e) }),
    );
  }, SWEEP_PERIOD_MS).unref();
}
