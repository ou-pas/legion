// The text of a task CARD: its marks (gate, blocker, goal origin) and its chips. The markers are
// drawn icons — these sentences are what the screen reader says in their place, so they are not
// decorative.
import { defineText } from "../../i18n/catalog.js";

export const TASK_CARD_TEXT = defineText({
  gate: "Approval gate",
  readOnly: "Read-only — nothing is pushed, no PR",
  /** The blocker mark NAMES its blockers (screen reader, tooltip): "blocked" is endured,
   *  "blocked by X" can be acted on. */
  blockedBy: (names: readonly string[]) => `Blocked by ${names.map((n) => `"${n}"`).join(", ")}`,
  fromGoal: "Step of a goal",

  /** THE SIX DERIVED STATES. They live here and not in the component, for the exact reason
   *  `sessions/session-status.ts` tells: batch 41 pulled out of `ui/chip.tsx` a chip that knew
   *  the six runtime statuses and their labels. A drawing object knows no domain; the domain
   *  vocabulary lives next to its domain.
   *
   *  "Conflicts with its column" and not "unknown state" for `contradiction`: a contradiction is
   *  NOT an unknown, it is a KNOWN disagreement between what the column claims and what the
   *  sessions show. That is the whole point of this chip — calling it "unknown" would turn the
   *  only thing it tells you into an admission of ignorance. */
  derived: {
    "not-started": "Not started",
    running: "Running",
    paused: "Waiting for an answer",
    blocked: "Waiting for approval",
    completed: "Completed",
    failed: "Failed",
    contradiction: "Conflicts with its column",
  } as Record<string, string>,
  /** What the screen reader says of a chip: the state, then the fact that produced it. */
  derivedSpoken: (label: string, fact: string) => `${label}: ${fact}`,

  /** THE FACT BEHIND A DERIVED STATE (`derive-task-state.ts`), when the session carries no
   *  `endReason` of its own. A session that ended DOES carry one, a sentence written by
   *  the server (`markSessionTerminal`), and it is shown as is rather than guessed at. These
   *  are only the fallbacks. */
  derivedFact: {
    neverRun: "No run",
    committing: "Finishing up",
    running: "Session running",
    waiting: "Session waiting for an answer",
    blocked: "Stopped on an approval",
    /** The lie `settleTaskAfterSession` exists to prevent: a task left in `doing` forever. */
    contradiction: "Session ended while the task is still in doing",
    failed: "Session failed",
    empty: "Ended without producing anything",
    stopped: "Stopped by the operator",
    completed: "Run finished",
  },

  queued: "queued",
  /** THE MISSING IMAGE REPLACES "queued" (12/09), which lied: no machine was going to pick this
   *  task up. Two states and not one — "missing" is fixed with a click, "rebuilding" only asks
   *  you to wait, and confusing them would make you click twice. */
  imageAbsent: "image missing",
  imageRebuilding: "image rebuilding",
  /** What the screen reader says of the chip: the state, then WHERE. A missing image without the
   *  name of the machine cannot be fixed. */
  imageWaitSpoken: (label: string, image: string, runner: string) =>
    `${label}: "${image}" on "${runner}"`,
  /** REPLACES `queued` when the queue SKIPS the task: its machine is not responding, or is out
   *  of disk, and no button in Legion fixes that (unlike a missing image, just above). "Queued"
   *  would promise a slot that does not free itself. */
  runnerWait: {
    "docker-down": (runnerName: string) => `Docker is not responding on "${runnerName}"`,
    "disk-full": (runnerName: string) => `disk full on "${runnerName}"`,
  } as Record<string, (runnerName: string) => string>,
  /** The chip COUNTS: a task can be held back by several since v44 (the slices of a batch all
   *  block the Wiki step), and the board says by how many (behavior 8). */
  blocked: (n: number) => `blocked by ${n}`,
  scheduled: "scheduled",
  step: (index: number) => `step ${index}`,
  /** Waiting on another task (`wait_for_task`) REPLACES the session chip. */
  waitingFor: (taskName: string) => `waiting for "${taskName}"`,
});
