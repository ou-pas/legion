// The structural SETTINGS of a task: the fields of the "Settings" tab, and — once the task has
// started — the reason they are frozen. The levels on offer are not here: they are the same as
// in the composer (`TASK_TEXT.priority` and `TASK_TEXT.complexity`, in vocabulary.ts), otherwise
// creating and editing would name the same choice differently.
//
// The reasons reuse the wording of `task-edit.ts` on the server: the screen and the server
// refusal (were the screen to lie) have to tell the same story.
import { defineText } from "../../i18n/catalog.js";

export const TASK_SETTINGS_TEXT = defineText({
  title: "Settings",
  listLabel: "Task settings",

  fields: {
    name: "Title",
    agent: "Agent",
    complexity: "Complexity",
    priority: "Priority",
    /** v2c (nav) — forces a model for this task, above complexity routing. */
    model: "Forced model",
    gate: "Approval gate",
    readOnly: "Read-only",
  },

  /** What "empty" DOES — same rule as the "no environment" label on the agent side: a field
   *  whose default effect cannot be guessed is worse than no field. */
  modelEmpty: "none — complexity routing picks the model",

  /** THE GUARDS SAY WHAT THEY DO: the name of a setting does not say what changes for the
   *  session — these two lines say it, once, under their checkbox. */
  guards: {
    gateWhy: "The PR waits for your approval before it is opened.",
    readOnlyWhy:
      "Repositories cloned read-only: nothing is pushed, no PR — proposals and artifacts only.",
  },

  /** The gate value read-only — a checkbox that can no longer be ticked is spelled out. */
  yes: "yes",
  no: "no",
  /** No agent assigned: the em dash holds the table row. */
  noAgent: "—",

  save: "Save",
  saved: "Saved",

  /** Where the task comes from when it was not posted by hand — editing stays LOCAL. */
  fromTemplate:
    "Step instantiated by a chain — editing stays local to this task, the chain itself is not changed.",
  fromGoal: "Task instantiated by a goal — editing stays local to this task.",

  /** Why it is frozen. Never a greyed-out control with a native `title`: it does not show on a
   *  disabled element (Chrome, Safari) — the reason is visible text. */
  locked: {
    demo: "demo project: read-only, nothing is edited here",
    running: (sessionStatus: string) =>
      `session ${sessionStatus}: its settings have already been sent, they cannot be rewritten after the fact`,
    started: (status: string) => `a "${status}" task has started: its settings are frozen`,
  },
});
