// The text of the BOARD: the five lanes, what they say when empty, and the gestures played
// there.
import { defineText } from "../../i18n/catalog.js";
import { type Task } from "../../api/tasks.js";
import { plural } from "../../ui/plural.js";

// `why` is only rendered when it states a cause `empty` does not already state (D5, 15/09,
// docs/DESIGN.md): "later" explains a filter (ideas noted, not started yet), the other four were
// restating their `empty` in other words and are gone. Typed apart from `defineText` (which
// freezes `const` literals and rejects a missing `why?` on some keys) so that
// `BOARD_TEXT.columns[status].why` stays a valid access whatever the status.
const columns: Record<Task["status"], { label: string; empty: string; why?: string }> = {
  later: {
    label: "Later",
    empty: "Nothing for later",
    why: "Ideas noted without being started pile up here.",
  },
  todo: { label: "Todo", empty: "No task waiting" },
  doing: { label: "Doing", empty: "No agent at work" },
  review: { label: "Review", empty: "Nothing to review" },
  done: { label: "Done", empty: "Nothing done" },
};

export const BOARD_TEXT = defineText({
  /** Infrastructure failure, said WHERE tasks are started (26/08). The board is the screen from
   *  which a task is set going: that is where "nothing can start" has to be readable, and not
   *  only on Runners, which one visits only when already suspecting something. */
  blocked: {
    daemon: "Docker is not responding",
    daemonWhy:
      "No Docker daemon reachable: a task started now will sit in the queue without starting. Start Docker Desktop (or make the ssh:// host reachable), then refresh.",
    image: "Session image missing",
    imageWhy:
      "The daemon answers but no runner carries the session image: run `make image` at the root of the repo.",
    // "Runners", no longer "Infra" (General batch, 02/09): that is the name the screen this link
    // leads to carries now.
    infra: "Open Runners",
  },
  title: "Board",

  // "Backlog" had been explicitly ruled out when naming the "Later" column: the empty state of a
  // column must not bring back the word its title refused.
  columns,

  /** The accessible name of the lane picker, at the phone breakpoint: the board renders only one
   *  lane, and this group of buttons says which. A group needs a name — without it, a screen
   *  reader announces five buttons without saying what the five choices are for. */
  lanePicker: "Lane shown",

  /** The accessible name of the load gauge: a column states a SHARE of the board. */
  columnLoad: (column: string, count: number, total: number) =>
    `${column} — ${count} ${plural(count, "task")} out of ${total}`,

  archiveAll: "Archive all",
  archiveTask: "Archive",
  archiveTaskWhy: "Archive — the task leaves the board without being deleted",
  archiveFailed: "Archiving failed",
  moveRefused: "Move refused",

  /** The drag handle: invisible until focus, it has to announce the gesture to the keyboard. */
  dragHandle: "move",
  dragTask: (name: string) => `Move "${name}" on the board — Space then arrow keys`,
});
