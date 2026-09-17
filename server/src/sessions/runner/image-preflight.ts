// Incident of 08/09 19:22: two tasks from two different projects died together on "docker run
// failed: No such image: legion-session:latest". The image belongs to the machine, not the
// project, which is why two projects fall together when it disappears from a host.
//
// `assertRunnerReady` (manager.ts) probed the daemon, the disk and the network wall, never the
// image: the task left, reserved its slot, created a `starting` session and died in `docker run`.
// `--pull=never` (docker.ts, deliberate) makes that `docker run` fail immediately instead of
// waiting on a remote registry, which is exactly why the absence must be seen here, before a slot
// is reserved for a container that will never start.
import { logControlEvent } from "../../events/control-log-store.js";
import { SESSION_IMAGE } from "../../infra/fleet-images.js";
import { recordImageVerdict } from "../../infra/images/verdict-store.js";
import { ImageAbsentError } from "./launch-errors.js";
import type { ImageProbe } from "./ports.js";

/** `spec.image ?? SESSION_IMAGE` (docker.ts) seen from the project: the image the launch will
 *  actually use, not the default tag. A project can name its own (docs/wiki/concepts/runner.md),
 *  and that is the image to probe. */
export function sessionImageFor(project: { sessionImage: string | null }): string {
  return project.sessionImage?.trim() || SESSION_IMAGE;
}

/** Names the runner AND the image, never the default tag alone: a project can name its own
 *  image, and a refusal that hides which one is useless. */
export function imageAbsentMessage(runnerName: string, image: string, why: string): string {
  return `Session image “${image}” missing on runner “${runnerName}”: ${why}`;
}

/** `imageProbe` null = no daemon involved (`process` runner), nothing to judge, same guard as
 *  the daemon probe.
 *
 *  Throws `ImageAbsentError` rather than a bare `Error` since 12/09: that type is what the
 *  reaction recognises to open a wait instead of relaunching the task against the same image.
 *  The message did not change; it is what the operator reads in the log. */
export async function assertImagePresent(
  imageProbe: ImageProbe | null,
  image: string,
  runnerRow: { id: string; name: string; dockerHost: string | null },
  taskId: string,
): Promise<void> {
  if (!imageProbe) return;
  const img = await imageProbe(runnerRow.dockerHost, image);
  // Remembered for `pickRunnerRow` (verdict-store.ts): the next choice, for another task, can
  // prefer a machine that has it instead of refusing this one a second time.
  recordImageVerdict(runnerRow.id, image, img);
  if (img.ok) return;
  const message = imageAbsentMessage(runnerRow.name, image, img.why);
  logControlEvent("warn", "preflight", message, { taskId, runnerId: runnerRow.id, image });
  throw new ImageAbsentError(message, {
    runnerId: runnerRow.id,
    runnerName: runnerRow.name,
    image,
  });
}
