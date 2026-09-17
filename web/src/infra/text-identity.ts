// The text of the Identity card. Kept apart from `text.ts` for the same reason as
// `text-version.ts`: this card does not describe Docker, it describes WHAT the control plane
// authenticates with.
import { defineText } from "../i18n/catalog.js";

export const IDENTITY_TEXT = defineText({
  title: "Identity",
  /** The word « active » matters: two variables can be set, only one is used. */
  kind: {
    "api-key": "API key",
    oauth: "Subscription (OAuth)",
    none: "No credential",
  },
  /** The priority order is a server rule, not a guess made by the screen: when both are set, the
   *  API key is the one used, and hiding that would cost a long search. */
  bothNote:
    "ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are both set. The API key is the one used: it takes priority.",
  noneTitle: "No credential",
  noneBody:
    "Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set in server/.env. No session can start.",
  /** We show a MASK, never the value. The server does not send it, and that is deliberate. */
  maskedLabel: "Value (masked)",
  maskedWhy: "The first eleven characters and the length. The full value never leaves the server.",
  warningsTitle: "To fix",
  loading: "Reading the active identity…",
});
