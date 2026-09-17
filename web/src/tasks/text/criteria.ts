// The text of the "what this task must prove" block. The same sentences as the agent's brief
// (`server/src/tasks/criteria.ts`, `renderCriteria`): the operator and the agent judge the same
// work, they must read the same list.
import { defineText } from "../../i18n/catalog.js";

export const TASK_CRITERIA_TEXT = defineText({
  title: "What this task must prove",
  validatedBy: "Validation command",
  listLabel: "Criteria of this task, in order",
  /** Written for the operator wondering why the agent handed the task over in review instead of
   *  marking it done: the sentence says that they are the judge, and on what. */
  why: "Its agent cannot mark it done: it hands the task over in review, and you judge it, criterion by criterion, on the evidence each mode demands.",
  /** The edge covered by a `property` criterion — the id from the edge file. */
  edge: (id: string) => `edge ${id}`,
});
