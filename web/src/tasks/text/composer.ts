// The text of the COMPOSER — the bar on the board and the ⌘K modal, which are the same controls
// in two geometries. This is where a task is started, so it is the most photographed strip of the
// product.
//
// What a task SETTING is called is not here: `text/settings.ts` already names Complexity,
// Priority, Approval gate and Read-only, and the composer reads those. Creating and editing must
// not name the same choice differently — the rule `text/settings.ts` states for the levels holds
// for the labels too.
import { defineText } from "../../i18n/catalog.js";
import { TASK_SETTINGS_TEXT } from "./settings.js";
import { plural } from "../../ui/plural.js";

export const COMPOSER_TEXT = defineText({
  /** The title names the task; the BRIEF is the instruction. An agent does not read between the
   *  lines of a title: what is not written there is not asked for. */
  name: "Describe the task",
  namePlaceholder: "Describe a task, or a chain request…",
  brief: "Task brief",
  briefPlaceholder:
    "What the agent needs to know: the context, what already exists, what is expected, what it must NOT touch, and how to check it is done.",

  /** Folded away in the bar, the brief still has to count: written then hidden must not look
   *  absent. Attachments live in the same fold and count with it, for the same reason. */
  briefToggle: "Brief",
  briefChars: (n: number) => `${n} chars`,
  briefFiles: (n: number) => `${n} ${plural(n, "file")}`,

  settingsToggle: TASK_SETTINGS_TEXT.title,
  /** A setting you touched yourself stays put: the proposal stops offering one for it. */
  settingsPinned: (n: number) => `${TASK_SETTINGS_TEXT.title} · ${n} pinned`,

  project: "Project",
  agent: "Agent or chain",
  agentGroup: "Agents",
  chainGroup: "Chains",
  chainSteps: (name: string, steps: number) => `${name} (${steps} ${plural(steps, "step")})`,

  complexityWhy: "Complexity → model (low = haiku, high = opus)",
  priorityWhy: "Priority → the order the queue picks tasks up",
  readOnlyWhy: TASK_SETTINGS_TEXT.guards.readOnlyWhy,

  run: "Run",
  /** A demo project runs nothing: announcing a shortcut with no effect would be a lie. */
  demoWhy: "Demo project, read-only: no agent is started",

  later: "Save for later",
  laterWhy: "Note the task without running it: it waits under Later, no agent picks it up",

  /** Noting is a SILENT gesture: from the dashboard there is no board in sight to watch the task
   *  land, so without this acknowledgement you cannot tell the click took. */
  deferredTitle: "Saved for later",
  deferredWhy: "No agent picks it up until you engage it.",
  launchFailed: "Task not started",
  deferFailed: "Task not saved",
  /** Guards, not screen copy — they only surface if the button is clicked in a state the
   *  composer says it refuses. */
  missingFields: "Missing fields",
  noProject: "No project",

  /** The ⌘K modal — same fields, stacked and labelled. */
  modal: {
    title: "Create a task",
    task: "Task",
    brief: "Brief",
    agent: "Agent / chain",
  },
});
