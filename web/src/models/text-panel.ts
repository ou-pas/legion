// The text of the system "Models" tab. Separate from `text.ts`, which belongs to the picker.
import { defineText } from "../i18n/catalog.js";

export const MODELS_PANEL_TEXT = defineText({
  title: "Available models",
  /** The old subtitle of the dedicated screen, folded into General (02/09): it says the one
   *  thing worth knowing in front of this list — where routing is set. */
  routingNote: "The models the SDK proposes. Routing per project is set in the project's settings.",
  fallback:
    "The SDK did not answer: this list is a fallback of aliases. It looks like the real one," +
    " it is not one.",
  effort: (levels: number) => `${levels} effort level(s)`,
  emptyTitle: "No model listed",
  emptyWhy:
    "Neither the SDK nor the fallback rendered an id. A model pinned by hand remains" +
    " possible from a project's or an agent's settings.",
});
