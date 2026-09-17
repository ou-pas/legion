// Who waits their turn: the queue, and nothing else.
//
// Split out of `manager.ts` (lot 11): the pump recounts slots, sorts candidates and launches. It
// cannot launch by itself, which keeps it acyclic: `manager.ts` plugs its `runTask` in on load
// (see `onTaskLaunch`), just as `index.ts` plugs PR opening into `onSessionEnded`. An `import()`
// does not break a cycle, it makes it unreadable; the dependency is therefore INVERTED.
import { blockedTaskIds } from "../../tasks/blockers.js";
import { tasksWaitingForImage } from "./image-wait.js";
import { pickRunnerRow, reprobeRunnerAvailability } from "./chosen-runner.js";
import { logControlEvent } from "../../events/control-log-store.js";
import { ACTIVE_STATUSES } from "../session-terminal.js";
import {
  activeSessionOfTask,
  isDemoProject,
  runnerPreferenceOf,
  setTaskQueued,
  todoTasks,
} from "./manager-store.js";
import {
  noteTaskWaitingOnRunner,
  runnerUnavailability,
} from "../../infra/runner/unavailability.js";

/** `pumpQueue` picks, `runTask` launches, and `runTask` needs the queue (it requeues a task at full
 *  capacity). Importing one from the other would close the cycle the architecture harness refuses.
 *  `manager.ts` plugs itself in here on load, the only module doing so: every importer of
 *  `runner/manager.js` keeps it wired without thinking about it. */
type TaskLauncher = (taskId: string) => Promise<string>;
let launchTask: TaskLauncher | null = null;

export function onTaskLaunch(launcher: TaskLauncher): void {
  launchTask = launcher;
}

const PRIORITY_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

/**
 * Todo IS the queue (operator's decision, 23/08 evening, replacing v13): "later = not started,
 * todo = taken as soon as possible. Two waiting columns make no sense."
 *
 * The pump used to take only `queued` tasks, a flag earned only by attempting a launch at full
 * capacity. A task just created in todo was a draft nothing started: a third, invisible waiting
 * state, discovered one evening wondering why the agents did not pick it up. Filing in todo IS the
 * commitment gesture; `later` is the only parking (out of reach, like the scheduler).
 *
 * Driven tasks keep their driver: a goal's tasks are never taken (the orchestrator decides), and a
 * chain step only if explicitly queued (`enqueueOnFull`, capacity full when `onTaskDone` launched
 * it); otherwise the pump would override `autoRunNext: false` ("unblocked but manual").
 * Idempotent, reentrant, called on every freed slot and by the scheduler tick.
 */
let pumping = false;

export function pumpQueue(): void {
  if (pumping) return;
  // No launcher wired: impossible in the wired application, where importing `runner/manager.js`
  // is enough. Say it loudly rather than silently draining the queue.
  const launch = launchTask;
  if (!launch) {
    logControlEvent("error", "queue", "queue not pumped: no task launcher wired");
    return;
  }
  pumping = true;
  try {
    const blocked = blockedTaskIds(); // a link = not taken, whatever the blocker's state
    // A missing image is skipped, not retried (12/09). Without this, the task restarted every
    // thirty seconds against a machine lacking the image. The wait outlives the ANSWER (the task
    // stays skipped during the two to four minutes of rebuild), so it cannot be inferred from "a
    // question is open" (`image-wait.ts`).
    const waitingForImage = tasksWaitingForImage();
    const candidates = todoTasks()
      .filter(
        (t) =>
          !t.goalId &&
          (!t.templateRunId || t.queued) &&
          !blocked.has(t.id) &&
          !waitingForImage.has(t.id) &&
          // Without an assignee (task proposed by an agent, human draft) runTask would fail and be
          // requeued, retried every tick for nothing.
          !!t.assigneeAgentId &&
          !isDemoProject(t.projectId),
      )
      .sort(
        (a, b) =>
          (PRIORITY_RANK[b.priority] ?? 2) - (PRIORITY_RANK[a.priority] ?? 2) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
    // An unavailable machine (Docker down, disk full, chosen-runner.ts) is probed only ONCE per
    // round, and only for machines holding a candidate of THIS round ("one probe per machine, not
    // per task", carried over from the image lot).
    const reprobedThisTick = new Set<string>();
    for (const t of candidates) {
      // Capacity left? pickRunnerRow throws when everything is full; stop then.
      let runnerRow: ReturnType<typeof pickRunnerRow>;
      try {
        runnerRow = pickRunnerRow(runnerPreferenceOf(t.assigneeAgentId ?? ""), t.chosenRunnerId);
      } catch {
        // A refusal concerning only this task does not stop the queue (v66). Without this, one
        // task pinned to a switched-off machine froze the whole fleet: the `break` was right while
        // every refusal was a FLEET fact ("no room", "nobody answers"), not once a candidate has
        // its own machine.
        if (t.chosenRunnerId) continue;
        break; // no room: the rest wait for the next pump
      }
      // The chosen machine looks fine in the registry (health, capacity, cached disk) but a REAL
      // launch found it unavailable (dead daemon, full disk): skip the task rather than retry,
      // otherwise the session restarted `failed` every thirty seconds against the same failure.
      const unavailability = runnerUnavailability(runnerRow.id);
      if (unavailability) {
        noteTaskWaitingOnRunner(runnerRow.id, t.id);
        if (!reprobedThisTick.has(runnerRow.id)) {
          reprobedThisTick.add(runnerRow.id);
          reprobeRunnerAvailability(runnerRow);
        }
        continue;
      }
      // Session already active (race)? skip.
      if (activeSessionOfTask(t.id, ACTIVE_STATUSES)) continue;
      setTaskQueued(t.id, false);
      logControlEvent("info", "queue", `task ${t.id} started from the queue`, {
        taskId: t.id,
        priority: t.priority,
      });
      void launch(t.id).catch((err) => {
        // Any error (capacity taken meanwhile, transient…) → requeued rather than lost: a queued
        // task must never silently disappear (review lot4 #4).
        setTaskQueued(t.id, true);
        logControlEvent("warn", "queue", `task ${t.id} queued again: ${(err as Error).message}`, {
          taskId: t.id,
        });
      });
    }
  } finally {
    pumping = false;
  }
}
