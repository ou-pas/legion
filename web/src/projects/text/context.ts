// The text of the CONTEXT section: the document every session of the project receives in its
// system prompt. One catalog per section, as the header of `project-page.ts` promises.
import { defineText } from "../../i18n/catalog.js";

export const CONTEXT_CARD_TEXT = defineText({
  title: "Project context",
  /** What the card sets, and above all WHO it belongs to: this is the operator's document,
   *  auto-enriched but never confiscated. */
  why: "Architecture, decisions, vocabulary — injected into the system prompt of every session of the project. Auto-enriched after each real task completes (light model); you can correct or clear it freely.",
  fieldLabel: "Context injected into every session",
  /** The counter: the value is a number, only the denominator and the word are copy. */
  limit: "/ 8000 characters",
  placeholder: "(empty — it will fill itself over runs, or write it yourself)",
  save: "Save",
  saved: "Saved",
});
