// The VOCABULARY of the tasks domain: the words several screens share (a column, a priority, a
// complexity). What belongs to a single screen lives in that screen's catalog (`text/board.ts`,
// `text/task-page.ts`…), never here.
import { defineText } from "../../i18n/catalog.js";
import { type Task } from "../../api/tasks.js";
import { TASK_STATUS } from "../../api/tasks.js";
import { plural } from "../../ui/plural.js";

export const TASK_TEXT = defineText({
  /** A status name MID-SENTENCE ("it picks up on its own as soon as … moves to review").
   *  The board columns carry the same states, but as titles: see `BOARD_TEXT.columns`. */
  status: {
    later: TASK_STATUS.later,
    todo: TASK_STATUS.todo,
    doing: TASK_STATUS.doing,
    review: TASK_STATUS.review,
    done: TASK_STATUS.done,
  } satisfies Record<Task["status"], string>,

  /** Priority sets the order in which the queue picks tasks up. */
  priority: {
    high: "high priority",
    med: "normal priority",
    low: "low priority",
  } satisfies Record<Task["priority"], string>,

  /** The same three levels, SHORT: three buttons or three options sitting under a label that
   *  already says "Priority" — prefixing each one would repeat it. `priority` above names the
   *  priority mid-sentence, which is a different job. */
  priorityShort: {
    high: "high",
    med: "normal",
    low: "low",
  } satisfies Record<Task["priority"], string>,

  /** Complexity picks the model — same word in the composer and on the card. */
  complexity: {
    low: "simple",
    med: "normal",
    high: "complex",
  } satisfies Record<Task["complexity"], string>,

  /** Solidarity between the change requests of a task that spans several repositories
   *  (`pr-solidarity.ts`) — shared by the PR tab and the verdict, which already read the same
   *  state query. Never a hardcoded "PR" or "pull request": `prUrls` carries GitLab as readily
   *  as GitHub, and nothing at this level can tell which one repo by repo — hence sentences
   *  about repositories and merging, never about the kind of request. */
  solidarity: {
    /** "1 of 2 merged" — the count the operator looks for when coming back to the task. */
    count: (merged: number, total: number) => `${merged} of ${total} merged`,
    rule: "this task is only done when all of them are",
    /** Names the repositories whose request is not merged — by repository, not by number: what
     *  is missing is a gesture, not one more count ("front merged, api waiting" reads; "1/2"
     *  does not say what to do). */
    waiting: (repos: string[]) =>
      `${repos.join(", ")} ${plural(repos.length, "is", "are")} waiting`,
    /** `prState` missing: the read never reached the forge. Distinct from "waiting" — this asks
     *  you to look into why, never to be patient. */
    unknown: (repos: string[]) => `state of ${repos.join(", ")} not known yet`,
  },
});
