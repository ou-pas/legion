// What happens when a machine lacks the image (12/09).
//
// `image-wait.ts` holds the memory of the refusal; this module is the reaction, and it is the one
// that touches the outside (Docker probe, inbox, rebuilds, parking). Three gestures:
//
//   1. `watchImageAbsence`: preflight just refused, the task joins the machine's wait. From then
//      on `pumpQueue` skips it: no more `failed` session every thirty seconds.
//   2. `sweepImageWaits`: one sweep round. Re-probe the image (the probe alone lifts the wait, not
//      the end of the rebuild container, which can finish without producing anything), ask the
//      question if not already asked, escalate past the grace period.
//   3. `answerImageRebuild`: the operator's answer, wired to the inbox port.
//
// Nobody relaunches anything here. The queue already pumps every thirty seconds: as soon as the
// probe sees the image, the task leaves on its own. Relaunching at the end of a rebuild would need
// a second wait mechanism for exactly the same result.
import { addNotice } from "../../inbox/notices.js";
import {
  askImageRebuild,
  closeImageRebuildQuestions,
  type ImageRebuildTarget,
} from "../../inbox/image-rebuild.js";
import { SESSION_IMAGE } from "../../infra/fleet-images.js";
import {
  imageRebuildRunning,
  startImageRebuild,
  IMAGE_TARGET,
} from "../../infra/images/rebuild.js";
import {
  projectImageRebuildRunning,
  startProjectImageRebuild,
} from "../../infra/images/project-rebuild.js";
import { logControlEvent } from "../../events/control-log-store.js";
import { applyTaskTransition, TASK_MOVE } from "../../tasks/lifecycle.js";
import type { ImageAbsentError } from "./launch-errors.js";
import {
  forgetImageWait,
  imageWaitKey,
  imageWaits,
  markImageWaitRebuilding,
  noteImageAbsent,
  noteImageRebuildStarted,
  overdueImageWaits,
  IMAGE_WAIT_GRACE_MS,
  type ImageWait,
} from "./image-wait.js";
import { runnerRow, taskNamesOf } from "./image-watch-store.js";
import { runnerProvider } from "./ports.js";

/** Fleet image or project image? The probed tag is the only fact available: a project that names
 *  its own image carries a tag other than `SESSION_IMAGE`. */
export function isFleetImage(image: string): boolean {
  return image === SESSION_IMAGE;
}

/** No write, no question: the sweep handles that on its next round, with the COMPLETE list of
 *  tasks that fell in the same queue round. */
export function watchImageAbsence(
  err: Pick<ImageAbsentError, "runnerId" | "runnerName" | "image">,
  launch: { taskId: string; projectId: string },
): void {
  noteImageAbsent({
    runnerId: err.runnerId,
    runnerName: err.runnerName,
    image: err.image,
    projectId: launch.projectId,
    taskId: launch.taskId,
  });
}

/** `null` when the question does not apply: the machine left the registry, or runs no
 *  containers. */
async function imageIsBack(wait: ImageWait): Promise<boolean | null> {
  const runner = runnerRow(wait.runnerId);
  if (!runner) return null;
  const probe = runnerProvider().imageProbe(runner.kind);
  if (!probe) return null;
  return (await probe(runner.dockerHost, wait.image)).ok;
}

/** Fleet and project rebuilds each have their own ephemeral container, hence their own read. */
async function rebuildRunningFor(wait: ImageWait): Promise<boolean> {
  return isFleetImage(wait.image)
    ? imageRebuildRunning(wait.runnerId)
    : projectImageRebuildRunning(wait.runnerId, wait.projectId);
}

const targetOf = (wait: ImageWait): ImageRebuildTarget => ({
  runnerId: wait.runnerId,
  runnerName: wait.runnerName,
  image: wait.image,
  projectId: wait.projectId,
});

/** Parking is the only place nothing leaves from on its own. Applies to EVERY task in the wait:
 *  the same image held them all. */
function parkWaitingTasks(wait: ImageWait): string[] {
  const names = taskNamesOf(wait.taskIds);
  for (const taskId of wait.taskIds) applyTaskTransition(taskId, TASK_MOVE.park);
  return names;
}

/** Fifteen minutes without the image. The question is NOT asked again: a failing rebuild needs a
 *  diagnosis on the machine, not a second click, and asking again would bring back the loop this
 *  lot closes. */
function escalate(wait: ImageWait, minutes: number): void {
  const names = parkWaitingTasks(wait);
  forgetImageWait(wait.runnerId, wait.image);
  closeImageRebuildQuestions(wait);
  const held = names.map((n) => `“${n}”`).join(", ") || "no task";
  const trail = wait.logPath ? ` Rebuild log: ${wait.logPath}.` : "";
  const message =
    `The “${wait.image}” image is still not on “${wait.runnerName}” after ${minutes} min: ` +
    `${held} moved to Later. The machine needs a look.${trail}`;
  addNotice(message, "task_failed");
  logControlEvent("warn", "image-wait", message, {
    runnerId: wait.runnerId,
    image: wait.image,
    taskIds: wait.taskIds,
  });
}

/** One probe per machine and image, only when tasks are waiting on it. Returns the number of
 *  waits lifted (image back).
 *
 *  The caller pumps the queue on a non-zero return, not this module: `pumpQueue` pulls
 *  `chosen-runner.ts`, which pulls this file to open the wait, so the cycle would close, and
 *  `index.ts` is the assembler that already owns the tick. */
export async function sweepImageWaits(
  now: number = Date.now(),
  graceMs: number = IMAGE_WAIT_GRACE_MS,
): Promise<number> {
  const waiting = imageWaits();
  if (waiting.length === 0) return 0;
  const overdue = new Set(
    overdueImageWaits(now, graceMs).map((w) => imageWaitKey(w.runnerId, w.image)),
  );
  let freed = 0;
  for (const wait of waiting) {
    const back = await imageIsBack(wait);
    // `null` = the probe cannot answer (machine removed, or runner without a daemon). The wait
    // drops, and the next launch will refuse naming its real cause rather than an image.
    if (back !== false) {
      forgetImageWait(wait.runnerId, wait.image);
      closeImageRebuildQuestions(wait);
      freed += 1;
      if (back)
        logControlEvent(
          "info",
          "image-wait",
          `image “${wait.image}” is back on “${wait.runnerName}”: ${wait.taskIds.length} task(s) resumed`,
          { runnerId: wait.runnerId, image: wait.image, taskIds: wait.taskIds },
        );
      continue;
    }
    if (overdue.has(imageWaitKey(wait.runnerId, wait.image))) {
      escalate(wait, Math.round(graceMs / 60_000));
      continue;
    }
    // A wait whose tasks all disappeared has nothing to rebuild for: no image is asked for nobody.
    const [taskId] = wait.taskIds;
    if (!taskId) continue;
    askImageRebuild(targetOf(wait), { taskId, taskIds: wait.taskIds });
    markImageWaitRebuilding(wait.runnerId, wait.image, await rebuildRunningFor(wait));
  }
  return freed;
}

/** Both rebuilds are passed in, not imported hard, same pattern as their `RebuildDeps`: a test
 *  must be able to check WHICH one starts, without an ephemeral container or a daemon. */
export interface RebuildLaunchers {
  fleet: typeof startImageRebuild;
  project: typeof startProjectImageRebuild;
}

const REAL_REBUILDS: RebuildLaunchers = {
  fleet: startImageRebuild,
  project: startProjectImageRebuild,
};

/** Wired to `ImageRebuilder` (inbox/ports.ts).
 *
 *  Rebuild starts and returns: the sweep's probe lifts the wait, not the end of the container,
 *  since a rebuild can finish without producing the image. Park moves every task this image
 *  held. */
export async function answerImageRebuild(
  target: ImageRebuildTarget,
  choice: "rebuild" | "park",
  deps: RebuildLaunchers = REAL_REBUILDS,
): Promise<void> {
  const wait = imageWaits().find((w) => w.runnerId === target.runnerId && w.image === target.image);
  if (choice === "park") {
    if (wait) {
      parkWaitingTasks(wait);
      forgetImageWait(wait.runnerId, wait.image);
    }
    return;
  }
  const started = isFleetImage(target.image)
    ? await deps.fleet(target.runnerId, [IMAGE_TARGET.session])
    : await deps.project(target.projectId, target.runnerId);
  if (!started.ok) {
    const message = `Rebuild of “${target.image}” refused on “${target.runnerName}”: ${started.error}`;
    addNotice(message, "task_failed");
    logControlEvent("warn", "image-wait", message, {
      runnerId: target.runnerId,
      image: target.image,
    });
    return;
  }
  noteImageRebuildStarted(target.runnerId, target.image, started.value.logPath);
  logControlEvent(
    "info",
    "image-wait",
    `rebuild of “${target.image}” started on “${target.runnerName}”`,
    { runnerId: target.runnerId, image: target.image, logPath: started.value.logPath },
  );
}
