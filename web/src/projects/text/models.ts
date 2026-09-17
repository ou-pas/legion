// The text of the MODELS section: the project's default model and the complexity → model
// routing.
import { defineText } from "../../i18n/catalog.js";

export const MODEL_ROUTING_TEXT = defineText({
  title: "Complexity → model routing",
  /** The card description, cut around the `opus` code chip: the order of the routing, then why an
   *  alias and a dated identifier are not the same choice. */
  descBefore:
    "A task's complexity picks its model when neither the task nor the agent imposes one (order: task override → agent model → complexity → project default). An alias (",
  descAfter:
    ") follows the model releases; a dated identifier pins one version, and that is then a choice visible here — never again a constant in the code.",
  /** THE DEFAULT MODEL (batch nav/2a): named as the fallback in the three pickers below without
   *  ever having had a field to set it — `projects.default_model` existed in the database, no
   *  screen exposed it. */
  defaultTitle: "Project default model",
  defaultWhy:
    "The last fallback of the routing: it serves when neither the task, nor the agent, nor the " +
    "complexity imposes a model. It cannot be left empty — nothing would take over.",
  defaultPickerLabel: "Project default model",
  defaultEmpty: "to be chosen",
  defaultRequired: "The default model cannot be empty.",
  /** The three levels, as they are written on a form — not the enum values. */
  levels: { low: "simple", med: "normal", high: "complex" },
  /** The accessible name of the picker: it has to say WHAT it sets the model for. */
  pickerLabel: (level: string) => `Model for “${level}” tasks`,
  /** The "nothing in particular" option, which NAMES the model we fall back to. */
  fallback: (model: string) => `project default (${model})`,
  save: "Save",
  saved: "Saved",
});
