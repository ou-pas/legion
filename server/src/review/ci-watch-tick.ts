// Red CI watch on open PRs (29/09, operator decision — deliberately a timer, not a webhook, going
// against the "never a poller" comments those two adapters used to carry).
//
// Every 5 minutes: for each `review` task whose project watches CI (`ciWatchEnabledFor`) and each of
// its open PRs, probe the checks and act (`decideCiWatchAction`), then persist what happened
// (`foldCiWatchState`) so a restart neither resets nor duplicates the counter.
//
// This module is the thin, impure shell: it reads the forge and the database and calls `fixCi`; the
// judgement itself lives in `ci-watch.ts`, tested without either.
import { nanoid } from "nanoid";
import { createLogger } from "../shared/log.js";
import { CHECK_STATE } from "../integrations/forge.js";
import { mergeStatesOf } from "../integrations/forge-access.js";
import { ACTIVITY_FROM } from "../tasks/activity-enums.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { fixCi } from "./review.js";
import { insertTaskActivity } from "./merge-events-store.js";
import {
  ciWatchAttemptLine,
  ciWatchEnabledFor,
  decideCiWatchAction,
  foldCiWatchState,
  INITIAL_CI_WATCH_STATE,
} from "./ci-watch.js";
import { ciWatchStateRow, saveCiWatchState, tasksInReviewWithProjectFlags } from "./ci-watch-store.js";

const log = createLogger("ci-watch");
const CI_WATCH_PERIOD_MS = 5 * 60_000;

/** `task.prUrls` decoded, same choice as `review.ts`'s own `prUrlsOf`: damaged JSON is no PRs
 *  rather than a broken tick. */
function prUrlsOf(raw: string): { repo: string; url: string }[] {
  try {
    return JSON.parse(raw) as { repo: string; url: string }[];
  } catch {
    return [];
  }
}

/** What a test can inject: the forge probe, the launch, and the outbound notification. Same
 *  shape as `merge-events.ts`'s `HandleDeps`, for the same reason — a database is cheap to fake in
 *  a tmp file, a forge and a running session are not. */
export type CiWatchDeps = {
  merge: typeof mergeStatesOf;
  fixCi: typeof fixCi;
  notifyOut: typeof notifyOut;
};

const DEFAULT_DEPS: CiWatchDeps = { merge: mergeStatesOf, fixCi, notifyOut };

/** One PR's turn: probe already done (`mergeStatesOf`), decide, act, persist. Never throws — a
 *  forge or launch failure on one PR must not stop the tick for the others; the caller logs it. */
async function watchOnePr(
  deps: CiWatchDeps,
  task: { id: string; name: string; projectId: string },
  pr: { repo: string; number: number; checkState: (typeof CHECK_STATE)[keyof typeof CHECK_STATE] },
): Promise<void> {
  const current = ciWatchStateRow(task.id, pr.repo, pr.number) ?? INITIAL_CI_WATCH_STATE;
  const action = decideCiWatchAction({ checkState: pr.checkState, state: current });
  const now = new Date();

  if (action === "nothing") return;

  if (action === "reset") {
    if (current.attempts === 0 && !current.notified) return; // already at rest, nothing to write
    saveCiWatchState(task.id, pr.repo, pr.number, foldCiWatchState(current, "green"), now);
    return;
  }

  if (action === "launch") {
    const result = await deps.fixCi(task.id, { repoName: pr.repo, number: pr.number });
    // A refusal (session active, 409, 502) does not count as an attempt: the PR is tried again on
    // the next tick, and the counter stays exactly where it was.
    if (!result.ok) return;
    const next = foldCiWatchState(current, "fix-launched");
    saveCiWatchState(task.id, pr.repo, pr.number, next, now);
    insertTaskActivity({
      id: nanoid(10),
      taskId: task.id,
      from: ACTIVITY_FROM.system,
      body: ciWatchAttemptLine(pr.repo, pr.number, next.attempts),
      createdAt: now,
    });
    return;
  }

  // action === "notify": the cap is spent and this is the first tick to notice it.
  deps.notifyOut(NOTIF_EVENT.ciFailed, { taskId: task.id, task: task.name, repoName: pr.repo });
  saveCiWatchState(task.id, pr.repo, pr.number, foldCiWatchState(current, "notified"), now);
}

/** One pass over every watched task. Exported for tests; the timer below is the only real caller. */
export async function ciWatchTick(deps: CiWatchDeps = DEFAULT_DEPS): Promise<void> {
  const candidates = tasksInReviewWithProjectFlags().filter(({ project }) =>
    ciWatchEnabledFor(project),
  );
  for (const { task } of candidates) {
    const prs = prUrlsOf(task.prUrls);
    if (prs.length === 0) continue;
    const states = await deps.merge(task.projectId, prs).catch(() => []);
    for (const state of states) {
      // Not open (merged, closed, or unresolved) or never probed for checks: nothing to act on. A
      // merged/closed PR belongs to `merge-events.ts`, not here.
      if (state.prState !== "open" || state.number === null || !state.checkState) continue;
      await watchOnePr(
        deps,
        { id: task.id, name: task.name, projectId: task.projectId },
        { repo: state.repo, number: state.number, checkState: state.checkState },
      ).catch((e: unknown) =>
        log.warn("ci watch failed on one PR", {
          taskId: task.id,
          repo: state.repo,
          number: state.number,
          error: String((e as Error)?.message ?? e),
        }),
      );
    }
  }
}

// Ticks don't overlap: a tick still running when the next is due is skipped, not queued — the next
// one 5 minutes later covers the same ground.
let running = false;

export function startCiWatch(): void {
  setInterval(() => {
    if (running) return;
    running = true;
    void ciWatchTick()
      .catch((e: unknown) => log.warn("ci watch tick failed", { error: String((e as Error)?.message ?? e) }))
      .finally(() => {
        running = false;
      });
  }, CI_WATCH_PERIOD_MS).unref();
}
