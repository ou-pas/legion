// The text of the composer's PROPOSAL line: what will be sent on launch, and where it comes
// from — the model, the defaults, or the operator's own hand.
import { defineText } from "../../i18n/catalog.js";

export const TASK_PROPOSAL_TEXT = defineText({
  pending: "reading the brief…",

  /** "proposed around your settings" when a field is pinned: the classifier worked WITH the
   *  operator's choice, never instead of it. */
  proposed: "proposed",
  proposedAround: "proposed around your settings",
  manual: "set by hand",
  fallback: "defaults — no proposal available",

  /** The accessible name of the pen mark on a pinned chip. */
  pinned: "pinned by hand",

  gate: "approval gate",
  noGate: "no gate",
});
