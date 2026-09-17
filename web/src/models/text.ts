// The text of the model picker, including an id pinned by hand.
import { defineText } from "../i18n/catalog.js";

export const MODEL_TEXT = defineText({
  pinOpen: "Pin an id",
  pinClose: "Back to the list",
  pinPlaceholder: "claude-opus-4-8",
  pinLabel: "Pinned id",
  checking: "Checking…",

  /** THE FOUR VERDICTS OF THE PROBE, and none of them is a refusal.
   *
   *  That is the server's decision, not the screen softening things: you can pin an id the SDK
   *  ignores and that WORKS — `claude-opus-4-8`, tried on 23/08, started and finished its session
   *  without any `supportedModels()` announcing it. So the list cannot arbitrate. The only refusal
   *  that counts is the one from session init, which names its error; this probe only brings the
   *  information forward. */
  verdict: {
    listed: "Already in the SDK list.",
    exists: "Confirmed by the API.",
    unknown: "The API does not know this id.",
    unverifiable:
      "Cannot be checked: the probe needs an API key, a subscription alone does not open this call.",
  },
  /** The warning, in full, so that it is not read as a block. */
  unknownWhy:
    "This is not a refusal: you can save. If the id is wrong, session startup will say so, and name it.",
});
