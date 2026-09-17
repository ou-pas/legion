// The text of LINEAGE: where a task comes from, what it left behind, and what can be done with
// it at the moment of closing the parent.
//
// The word matters here more than elsewhere. "Run" would be wrong — the button opens no session,
// it hands the task to an agent and moves it to todo, and it is the QUEUE that will pick it up
// when a slot frees. "Move to todo" would be accurate but would not say the consequence. So we
// write both: the gesture in the button, the consequence beside it.
import { defineText } from "../../i18n/catalog.js";

export const TASK_LINKS_TEXT = defineText({
  title: "Lineage",

  /** The heading of each half. "Proposed during" and "Proposed" name the same gesture
   *  (`propose_task`) seen from both ends — an agent at work can leave a task for later, it does
   *  not run it. */
  parent: "Proposed during",
  children: "Proposed",
  childrenLabel: "Tasks proposed during this task",

  /** What we recall when the parent reaches its end: closing a piece of work is the exact place
   *  where you remember what it left behind. */
  pending: (n: number) =>
    n === 1 ? "This work left one task pending." : `This work left ${n} tasks pending.`,
  /** Written so that it reads under a count of one OR several: the sentence follows that count,
   *  and anything that agrees with a single task reads as a mistake under "2 tasks pending". */
  pendingWhy:
    'A pending task does not start on its own: "Later" is a parking spot, and the queue only picks up what carries an agent.',

  /** The button for a child that can be set going in one gesture. */
  adopt: (agent: string) => `Hand to ${agent}`,
  adoptWhy: (agent: string) =>
    `Assigns it to ${agent} and moves it to todo. Todo is the queue: it will start as soon as a slot frees up.`,

  /** The child that cannot be set going from here — the suggestion no longer points at an agent
   *  of the project. We open the task, where an agent is chosen for good. */
  open: "Open",
  staleWhy: (name: string) =>
    `Agent "${name}", suggested at the time, no longer exists in this project: pick one on the task.`,

  /** Where the agent shown on a row comes from — assigned for good, or merely suggested by the
   *  agent that proposed the task. The difference decides what the button does. */
  suggested: (name: string) => `suggested: ${name}`,
  noAgent: "no agent",

  /** The mark of a lineage that is a DEPENDENCY, not an extra. */
  prerequisite: "prerequisite",
  prerequisiteWhy:
    "Proposed as a prerequisite: the task it came from is marked blocked until this one is done.",

  /** Read from the PARENT: what it delivered does not stand on its own. */
  unmet: (name: string) => `Prerequisite not met: "${name}".`,
  unmetWhy:
    "What was delivered here does not work until that task has landed. Approving is still possible, but no longer by accident.",

  /** Read from the CHILD: the same fact, from the other end. */
  awaited: (name: string) => `"${name}" is waiting for this task.`,
  awaitedWhy: "It is marked blocked by this one: until this work is done, it is not complete.",

  adoptRefused: "Assignment refused",
});
