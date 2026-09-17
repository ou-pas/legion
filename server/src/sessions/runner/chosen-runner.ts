// The runner chosen by the operator, applied to selection (v66, 09/09).
//
// `pickRunnerRow` arbitrates between the fleet's machines (health, capacity, disk, load). When the
// task designates one (`tasks.chosen_runner_id`) there is nothing left to arbitrate: this module
// only narrows the candidate set, deliberately. The refusals that follow (asleep, full, disk)
// remain the fleet's, applied to a one-machine set, so they name it on their own.
//
// The choice is hard, unlike `agents.runner_preference`, which is soft (it goes first in the sort
// and falls back to the least loaded). A fallback here would cancel the gesture silently: the
// operator chose this machine BECAUSE the others did not suit.
import {
  ChosenRunnerError,
  ImageAbsentError,
  NoCapacityError,
  NoDiskError,
  NoReachableRunnerError,
} from "./launch-errors.js";
import { watchImageAbsence } from "./image-watch.js";
import { runnerReachable } from "../../infra/runner-reachability.js";
import { diskFreeMb, diskLaunchBlocker } from "../../infra/metrics/index.js";
import { latestRunnerMetrics } from "../../infra/metrics/store.js";
import { OCCUPYING_STATUSES } from "../../infra/runner/limits.js";
import { assertImagePresent } from "./image-preflight.js";
import { latestImageVerdict } from "../../infra/images/verdict-store.js";
import { blockerMessage, networkBlockers } from "../preflight.js";
import { markSessionTerminal, SESSION_STATUS } from "../session-terminal.js";
import { runnerProvider, type DaemonProbe, type ImageProbe } from "./ports.js";
import {
  clearRunnerUnavailableReason,
  markRunnerUnavailable,
  runnerUnavailability,
  RUNNER_UNAVAILABLE_REASON,
} from "../../infra/runner/unavailability.js";
import { buildNetworkPolicy, grantedReposOf } from "./spec.js";
import { logControlEvent } from "../../events/control-log-store.js";
import {
  allRunnerRows,
  sessionCountByRunnerInStatus,
  type AgentRow,
  type RunnerRow,
} from "./manager-store.js";

/** `rows` carries the WHOLE registry, not only enabled runners: a choice pointing at a disabled
 *  machine must read "disabled", not "no longer exists". The two are repaired by different
 *  gestures. Pure (rows are passed in): testable without a database or docker. */
export function chosenRunnerCandidates<R extends { id: string; name: string; enabled: boolean }>(
  rows: readonly R[],
  chosenRunnerId: string,
): R[] {
  const chosen = rows.find((r) => r.id === chosenRunnerId);
  if (!chosen)
    throw new ChosenRunnerError(
      "the runner chosen for this task no longer exists in the fleet — choose another one, or none",
    );
  if (!chosen.enabled)
    throw new ChosenRunnerError(
      `the chosen runner “${chosen.name}” is disabled — enable it again, or choose another one`,
    );
  return [chosen];
}

// Which machine, and is it ready? Moved from `manager.ts` (lot 11): selection and the checks that
// follow it (daemon, image, disk, network wall) answer the same question and are read together.

/** `preference` is a runner name from the AGENT: soft, it goes first in the final sort and falls
 *  back to the least loaded. `chosenRunnerId` comes from the TASK (v66) and is hard: it narrows the
 *  candidates to that machine, or refuses naming it. `null` on both sides = the whole fleet, by
 *  far the most common case.
 *
 *  `image` (12/09) is the image the launch will actually use (`sessionImageFor(project)`). When
 *  known, it sets aside candidates whose last known verdict (`verdict-store.ts`) is a refusal,
 *  like the disk. `null` for callers that do not know it yet (queue capacity pre-check, resume):
 *  they filter nothing. */
export function pickRunnerRow(
  preference: string | null,
  chosenRunnerId: string | null = null,
  image: string | null = null,
) {
  const registry = allRunnerRows();
  const rows = chosenRunnerId
    ? chosenRunnerCandidates(registry, chosenRunnerId)
    : registry.filter((r) => r.enabled);
  if (rows.length === 0) throw new Error("no enabled runner");
  // Health before capacity (v51, multi-machine work). The strong machines SLEEP: routing to a
  // sleeping Mac gave a `starting` session nothing ever caught. `runnerReachable` reads
  // `last_seen_at`, kept by the periodic probe with two periods of hysteresis; a `process` runner
  // is always reachable, it has no daemon.
  //
  // Two refusals, not one, because they are two failures with two gestures: "no room" is solved
  // by waiting or raising the ceiling, "nobody answers" by waking a machine. `runTask` reads the
  // error TYPE to decide whether to queue (launch-errors.ts): only `NoCapacityError` queues.
  const reachable = rows.filter((r) => runnerReachable(r));
  if (reachable.length === 0) {
    // A task that designated its machine learns nothing from a list: `rows` holds ONE, and that
    // is the one asleep. Same error type (it does not queue, it surfaces).
    const names = rows.map((r) => r.name).join(", ");
    throw new NoReachableRunnerError(
      chosenRunnerId
        ? `the chosen runner “${names}” is not answering — is the machine switched on?`
        : `no reachable runner (${names}) — is the machine switched on?`,
    );
  }
  const load = sessionCountByRunnerInStatus(OCCUPYING_STATUSES);
  const withPlace = reachable.filter((r) => (load.get(r.id) ?? 0) < r.maxConcurrentSessions);
  // Capacity stays the ONLY refusal that queues, chosen machine or not: a slot frees itself, a
  // switched-off machine does not.
  if (withPlace.length === 0)
    throw new NoCapacityError(
      chosenRunnerId
        ? `the chosen runner “${reachable.map((r) => r.name).join(", ")}” is full`
        : "all runners at capacity",
    );

  // Disk is a selection criterion, not only a refusal (04/09).
  //
  // The preflight disk guardrail comes AFTER this choice: it refused the runner just designated,
  // the queue put the task back, and the next round designated the SAME runner since nothing in
  // the criteria had changed. Seen looping on `k2yUsVeGNK` while `portable-atelier` had fourteen
  // gigabytes free and zero sessions: a two-machine fleet fully blocked by the state of one.
  //
  // A missing measurement does not exclude, the rule `diskLaunchBlocker` already carries (refuse
  // only what is CERTAIN). It matters twice here: a freshly declared runner has not been probed
  // yet, and excluding it would make it unusable until its first measurement. Preflight stays
  // behind as a net, since the disk can fill between this choice and the launch.
  const spacious = withPlace.filter(
    (r) => !diskLaunchBlocker(latestRunnerMetrics(r.id)?.disk ?? null),
  );
  if (spacious.length === 0) {
    // `NoDiskError`, not `NoCapacityError`: a queue waiting for room never unblocks when what is
    // missing is disk.
    const detail = withPlace
      .map((r) => `${r.name}: ${diskLaunchBlocker(latestRunnerMetrics(r.id)?.disk ?? null) ?? "?"}`)
      .join(" · ");
    throw new NoDiskError(`no runner has enough disk — ${detail}`);
  }

  // The image prefers a machine that has it, it never refuses (12/09; split out of the batch that
  // offered to rebuild a missing image, spec `J5tmew3aT8`).
  //
  // Unlike the disk, nothing is probed here: one `docker image inspect` per candidate per round
  // would cost an SSH connection per remote machine. `latestImageVerdict` rereads what probes
  // already running elsewhere observed (a previous launch's preflight, the Infra screen).
  //
  // If every remaining candidate is known to lack the image, no refusal here: that refusal stays
  // preflight's, already named (`image-preflight.ts`). Duplicating it with another message would
  // blur the path the missing-image inbox entry must take.
  const withImage = image
    ? spacious.filter((r) => latestImageVerdict(r.id, image)?.ok !== false)
    : spacious;
  const candidates = withImage.length > 0 ? withImage : spacious;

  if (preference) {
    const preferred = candidates.find((r) => r.name === preference);
    if (preferred) return preferred;
  }
  candidates.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
  return candidates[0]!;
}

/** The launch being judged. These five arrive together from `runTask` and only make sense
 *  together. */
export interface LaunchAttempt {
  runnerRow: RunnerRow;
  image: string;
  taskId: string;
  agent: AgentRow;
  projectId: string;
}

/** Daemon, image, disk, network wall: what must hold for a container to start. Throws with the
 *  cause spelled out. The caller has ALREADY reserved its slot (see `runTask`'s invariant) and
 *  releases it on a refusal; this only judges. */
async function assertRunnerReady(
  probe: DaemonProbe,
  imageProbe: ImageProbe | null,
  launch: LaunchAttempt,
): Promise<void> {
  const { agent, image, projectId, runnerRow, taskId } = launch;
  // Does the daemon answer? (25/08) Without this, a stopped Docker gave a `starting` session
  // nothing caught and a `doing` task lying to the board for hours. Like preflight.ts, only the
  // CERTAIN is refused, and a daemon not answering `docker version` within 5 s is certain.
  const daemon = await probe(runnerRow.dockerHost);
  if (!daemon.ok) {
    const message = `Docker is not answering on runner “${runnerRow.name}”: ${daemon.why}`;
    // No gesture to offer from Legion (12/09): unlike a missing image there is no rebuild button.
    // `pumpQueue` reads this mark to skip the task instead of retrying against the same machine
    // every thirty seconds (infra/runner/unavailability.ts).
    markRunnerUnavailable(
      runnerRow.id,
      runnerRow.name,
      RUNNER_UNAVAILABLE_REASON.dockerDown,
      message,
    );
    logControlEvent("warn", "preflight", message, { taskId, runnerId: runnerRow.id });
    throw new Error(message);
  }
  // Only the docker-down unavailability is lifted, not a full disk seen elsewhere.
  clearRunnerUnavailableReason(runnerRow.id, RUNNER_UNAVAILABLE_REASON.dockerDown);
  await assertImagePresent(imageProbe, image, runnerRow, taskId); // a machine fact, see image-preflight.ts
  // Disk before the failure (04/09, incident javxU8Wwjx): a session that starts only to die ten
  // minutes later on a `write error` costs more than an immediate refusal naming the cause. The
  // last known measurement (periodic probe, `infra/metrics/`) is enough, no live probe here.
  // `diskLaunchBlocker` never refuses on a missing or stale measurement.
  const disk = latestRunnerMetrics(runnerRow.id)?.disk ?? null;
  const diskBlocked = diskLaunchBlocker(disk);
  if (diskBlocked) {
    const message = `${diskBlocked} on runner “${runnerRow.name}”`;
    // Same fate as a stopped daemon: no gesture from Legion, the queue skips the task instead of
    // relaunching it against the same full disk every thirty seconds.
    markRunnerUnavailable(
      runnerRow.id,
      runnerRow.name,
      RUNNER_UNAVAILABLE_REASON.diskFull,
      message,
    );
    logControlEvent("warn", "preflight", message, {
      taskId,
      runnerId: runnerRow.id,
      freeMb: disk ? diskFreeMb(disk) : null,
    });
    throw new Error(message);
  }
  clearRunnerUnavailableReason(runnerRow.id, RUNNER_UNAVAILABLE_REASON.diskFull);
  // The wall against granted repos (25/08). Since "no environment" means an EMPTY allowlist, an
  // agent can carry a repo it may no longer reach: without this check the clone fails deep in the
  // container, after a model turn, on an unreadable proxy refusal.
  //
  // Same condition as the Docker probe: the ProcessRunner enforces NO wall (it says so in
  // `run_warning`), so refusing a process-mode launch over an allowlist that does not exist there
  // would be an imaginary refusal.
  const netBlockers = networkBlockers({
    agentName: agent.name,
    network: buildNetworkPolicy(agent),
    grantedRepos: grantedReposOf(agent, projectId),
  });
  if (netBlockers.length > 0) {
    const message = blockerMessage(netBlockers);
    logControlEvent("warn", "preflight", `launch refused for “${agent.name}”: ${message}`, {
      agentName: agent.name,
      taskId,
      blockers: netBlockers,
    });
    throw new Error(message);
  }
}

/** Runs AFTER the reservation and AFTER the queue: full capacity is not a failure, and a task that
 *  goes to the queue does not need a live Docker. A refusal releases the slot (the row goes
 *  `failed` with the cause, through the only allowed writer) and is rethrown as is: a direct
 *  caller gets the message, `pumpQueue` requeues the task in its `.catch`. The task has not moved
 *  yet (`markTaskStarted` comes after), so it stays where it was.
 *
 *  Without a daemon involved (`process` runner, forced process mode, runtime injected by a test),
 *  the port returns no probe and there is nothing to judge. */
export async function assertRunnerReadyOrRelease(
  sessionId: string,
  launch: LaunchAttempt,
): Promise<void> {
  const probe = runnerProvider().daemonProbe(launch.runnerRow.kind);
  if (!probe) return;
  try {
    await assertRunnerReady(probe, runnerProvider().imageProbe(launch.runnerRow.kind), launch);
  } catch (err) {
    markSessionTerminal(sessionId, SESSION_STATUS.failed, String((err as Error)?.message ?? err));
    // A missing image opens a wait (12/09): from here the queue SKIPS this task instead of
    // relaunching it against the same machine every thirty seconds. The only refusal that leaves
    // a trace beyond the session; the others fix themselves (a slot frees, a disk empties) or go
    // up to the operator.
    if (err instanceof ImageAbsentError)
      watchImageAbsence(err, { taskId: launch.taskId, projectId: launch.projectId });
    throw err;
  }
}

/** Recovery probe, once per machine per round (12/09). `pumpQueue` calls it for each runner it
 *  just skipped; it only observes, reserves nothing and creates no session. Without it, a runner
 *  marked unavailable would stay so forever, since `pumpQueue` skips its tasks and never retries
 *  the launch that alone could observe the recovery.
 *
 *  Disk: no live probe, the periodic measurement (`infra/metrics/`) already runs on its own.
 *  Daemon: a live `docker version` in the background (not awaited); `pumpQueue` stays synchronous,
 *  so the recovery shows on the NEXT round. */
export function reprobeRunnerAvailability(runnerRow: RunnerRow): void {
  const entry = runnerUnavailability(runnerRow.id);
  if (!entry) return;
  if (entry.reason === RUNNER_UNAVAILABLE_REASON.diskFull) {
    const disk = latestRunnerMetrics(runnerRow.id)?.disk ?? null;
    if (!diskLaunchBlocker(disk)) clearRunnerUnavailableReason(runnerRow.id, entry.reason);
    return;
  }
  const probe = runnerProvider().daemonProbe(runnerRow.kind);
  if (!probe) {
    clearRunnerUnavailableReason(runnerRow.id, entry.reason); // no daemon involved anymore
    return;
  }
  probe(runnerRow.dockerHost)
    .then((result) => {
      if (result.ok)
        clearRunnerUnavailableReason(runnerRow.id, RUNNER_UNAVAILABLE_REASON.dockerDown);
    })
    .catch(() => {
      // A probe that throws instead of answering `{ ok: false }` teaches nothing more than an
      // ordinary refusal: the runner stays marked, the next round retries.
    });
}
