// The text of an ARTIFACT — the chip (awaited or dropped) and its preview. The file name is
// data, not copy: it crosses these sentences untranslated.
import { defineText } from "../../i18n/catalog.js";

export const ARTIFACT_TEXT = defineText({
  /** The chip is a TWO-state button: its accessible name says which of the two gestures the
   *  click triggers, not just what it shows. */
  open: (name: string) => `Open the preview of ${name}`,
  close: (name: string) => `Close the preview of ${name}`,
  /** Expected by the step, not written yet: the chip exists before the file. */
  awaited: (name: string) => `${name} — expected, not dropped yet`,

  /** The unit of the size shown on the chip. */
  kilobytes: "kB",

  preview: (name: string) => `Preview of ${name}`,
  closePreview: "Close the preview",
  /** The preview is BOUNDED in height (see `--h-scroll-lg`): an HTML report taller than the
   *  frame is read full size through this gesture, not by letting the preview eat the screen. */
  openTab: (name: string) => `Open ${name} in a tab`,

  /** A non-image binary cannot be previewed: the sentence says why, the link says the way out. */
  noPreview: "This file cannot be previewed here.",
  download: (name: string) => `Download ${name}`,
});
