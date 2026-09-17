// The text of the QUICK CREATE POPUP — the one that makes a Legion task out of something that
// already exists elsewhere: a Linear issue, a review comment.
//
// It lives in `tasks/` and not in `integrations/` or `review/` because the popup belongs to the
// TASKS domain: what it asks for (a name, an agent, a gate, run or not) says nothing about
// Linear or GitHub. Both original catalogs carried these very sentences, word for word, each on
// its own side; what stays with them is what describes THEIR origin — the popup title, the
// suggested name, the preview and the sentence that says what running it will cause over there.
import { defineText } from "../../i18n/catalog.js";

export const QUICK_TASK_TEXT = defineText({
  cancel: "Cancel",
  /** "Create", or "Create and run" when the box is ticked. The suffix is a PARAMETER and not two
   *  pieces glued at the call site: the verb and its complement stay together. */
  create: (andRun: string) => `Create${andRun}`,
  andRun: " and run",
  taskField: "Task",
  agentField: "Agent",
  gate: "Approval gate",
  runNow: "Run now",
  /** The task EXISTS, only the run was refused: the sentence has to say both, otherwise the
   *  operator recreates a task that is already there. */
  launchRefused: (message: string) => `Task created but run refused: ${message}`,
});
