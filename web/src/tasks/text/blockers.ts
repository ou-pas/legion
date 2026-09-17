// The text of what HOLDS a task back: the blockers panel of the page. The card only counts
// (`text/card.ts`); here we name them, and we say what the wait means.
import { defineText } from "../../i18n/catalog.js";

export const TASK_BLOCKERS_TEXT = defineText({
  title: (n: number) => (n === 1 ? "Blocked by one task" : `Blocked by ${n} tasks`),
  listLabel: "Tasks blocking this one",
  /** Written for the operator looking for the "Run" button and not finding it: the sentence says
   *  why, and what will make the gesture possible. */
  why: "It will not run, by hand or through the queue, until one of these tasks is done or deleted. The last one to finish releases it.",
});
