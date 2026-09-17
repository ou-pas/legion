// The text of the GENERAL tab (batch nav/2a): what the project IS. The name, the color and the
// context each already have their own catalog (`project-name.ts`, `hue.ts`, `context.ts`); this
// one carries only the single field that had neither card nor catalog before that batch — the
// output folder, shown here read-only.
import { defineText } from "../../i18n/catalog.js";

export const PROJECT_GENERAL_TEXT = defineText({
  fsRoot: {
    title: "Output folder",
    label: "fsRoot",
    /** Seen nowhere before this batch except as a header chip on the eight former tabs; it is
     *  chosen when the project is created ("New project" modal), never here. */
    empty: "None — path decided by the control plane.",
  },
});
