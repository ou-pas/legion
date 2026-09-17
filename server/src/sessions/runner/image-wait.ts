// What waits for an image: a fact about a machine, not a task (12/09).
//
// Preflight refuses the launch when the image is not on the chosen machine, rightly so:
// `--pull=never` would fail the `docker run` anyway. What went wrong was what followed: the task
// did not move, `pumpQueue` picked it up thirty seconds later, `pickRunnerRow` chose the same
// machine again, and the cycle restarted. One `failed` session and two log lines every thirty
// seconds, per affected task, forever.
//
// This module is the memory of that refusal and nothing else: it does not probe, writes neither
// database nor inbox, and starts no rebuild.
//
// The key is `(runnerId, image)`, not the task. Five tasks that fell together on the same machine
// are one failure: they share a wait, a question, and a rebuild that unblocks them all.
//
// In memory, without a migration (operator's decision, 12/09). A control plane restart costs one
// more failed session: the wait rebuilds itself on the next refusal. Deduplicating the question
// is read from the database (`inbox/image-rebuild.ts`), which is what makes it restart-proof.

/** Fifteen minutes without an image: the wait is no longer one, and the tasks move to later with
 *  a notice. Chosen by analogy with `STALLED_START_MS` (4 min) and the "2 to 4 min" the Infra card
 *  announces. Not measured, and the spec says so. */
export const IMAGE_WAIT_GRACE_MS = 15 * 60_000;

export interface ImageAbsence {
  runnerId: string;
  runnerName: string;
  image: string;
  /** Only used when `image` is the image this project declares: then `startProjectImageRebuild`
   *  must be called, not the fleet one. */
  projectId: string;
  taskId: string;
}

export interface ImageWait {
  runnerId: string;
  runnerName: string;
  image: string;
  projectId: string;
  /** First refusal seen, in ms. The grace period counts from it, not from the last one. */
  since: number;
  /** Set when the answer starts a rebuild, refreshed by the sweep. */
  rebuilding: boolean;
  /** The rebuild's log, `null` until one was started. It is the only lead left when the grace
   *  period expires: the notice names it, because a failing rebuild needs a diagnosis on the
   *  machine, not a second click. */
  logPath: string | null;
  taskIds: string[];
}

interface WaitEntry extends Omit<ImageWait, "taskIds"> {
  tasks: Set<string>;
}

const waits = new Map<string, WaitEntry>();

/** `\0`: no id or image tag contains it, so `("a", "b:c")` and `("a:b", "c")` cannot collide. */
export function imageWaitKey(runnerId: string, image: string): string {
  return `${runnerId}\0${image}`;
}

const snapshot = (e: WaitEntry): ImageWait => ({
  runnerId: e.runnerId,
  runnerName: e.runnerName,
  image: e.image,
  projectId: e.projectId,
  since: e.since,
  rebuilding: e.rebuilding,
  logPath: e.logPath,
  taskIds: [...e.tasks],
});

/** The task joins the machine's existing wait, or opens one. `opened` is what the orchestration
 *  reads to ask its question only once. */
export function noteImageAbsent(
  absence: ImageAbsence,
  now: number = Date.now(),
): { wait: ImageWait; opened: boolean } {
  const key = imageWaitKey(absence.runnerId, absence.image);
  const existing = waits.get(key);
  if (existing) {
    existing.tasks.add(absence.taskId);
    return { wait: snapshot(existing), opened: false };
  }
  const entry: WaitEntry = {
    runnerId: absence.runnerId,
    runnerName: absence.runnerName,
    image: absence.image,
    projectId: absence.projectId,
    since: now,
    rebuilding: false,
    logPath: null,
    tasks: new Set([absence.taskId]),
  };
  waits.set(key, entry);
  return { wait: snapshot(entry), opened: true };
}

/** What the sweep re-probes, one per machine and image. */
export function imageWaits(): ImageWait[] {
  return [...waits.values()].map(snapshot);
}

/** What the board pill reads (image missing, then image rebuilding). */
export function imageWaitOfTask(taskId: string): ImageWait | null {
  for (const e of waits.values()) if (e.tasks.has(taskId)) return snapshot(e);
  return null;
}

/** The tasks the queue must skip. A set, tested per task by the pump, exactly like
 *  `blockedTaskIds`. */
export function tasksWaitingForImage(): Set<string> {
  const ids = new Set<string>();
  for (const e of waits.values()) for (const id of e.tasks) ids.add(id);
  return ids;
}

/** Silent if the wait was already lifted: the image coming back wins over the state of the
 *  container that was building it. */
export function markImageWaitRebuilding(
  runnerId: string,
  image: string,
  rebuilding: boolean,
): void {
  const entry = waits.get(imageWaitKey(runnerId, image));
  if (entry) entry.rebuilding = rebuilding;
}

/** The path is kept even when the rebuild ends without bringing the image back: it is what the
 *  escalation notice gives. */
export function noteImageRebuildStarted(runnerId: string, image: string, logPath: string): void {
  const entry = waits.get(imageWaitKey(runnerId, image));
  if (!entry) return;
  entry.rebuilding = true;
  entry.logPath = logPath;
}

/** The image came back, or the tasks moved to later. `null` if already lifted. */
export function forgetImageWait(runnerId: string, image: string): ImageWait | null {
  const key = imageWaitKey(runnerId, image);
  const entry = waits.get(key);
  if (!entry) return null;
  waits.delete(key);
  return snapshot(entry);
}

/** Counted from the first refusal: a rebuild started along the way does not reset the clock,
 *  otherwise a machine rebuilding in a loop would never escalate. */
export function overdueImageWaits(
  now: number = Date.now(),
  graceMs: number = IMAGE_WAIT_GRACE_MS,
): ImageWait[] {
  return imageWaits().filter((w) => now - w.since >= graceMs);
}

/** For tests, which share the module with every other test. */
export function clearImageWaits(): void {
  waits.clear();
}
