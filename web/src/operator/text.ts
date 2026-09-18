// The text of the operator sign-in. It speaks of the gesture, never of the mechanism: nobody needs
// to read "sha-256" to paste a token, and saying it would give a stranger information about the
// instance they have no business having.
import { defineText } from "../i18n/catalog.js";

export const OPERATOR_TEXT = defineText({
  signIn: {
    title: "Legion",
    lede: "This instance asks for an operator token before opening anything.",
    label: "Operator token",
    /** The hint says WHERE to find it. That is the only question someone arriving here for the
     *  first time asks, and the answer is in a terminal output they may still have in front of
     *  them. */
    hint: "It is shown once, when the control plane that created it starts.",
    placeholder: "Paste it here",
    submit: "Enter",
    refused: "Token refused.",
    /** Lost, it cannot be found again: only the hash is kept. The sentence gives the way out
     *  rather than leaving you to search. */
    lost: "Lost the token? It cannot be recovered, only regenerated from the machine hosting the control plane.",
  },

  /** The first-run screen (18/09): shown once, before any operator session has ever opened, so the
   *  one question a fresh install asks first — where is the token — gets commands instead of a
   *  hint pointing at a boot log nobody is watching yet. */
  setup: {
    title: "First launch",
    lede: "Legion generated an operator token when the control plane started. Two ways to get it.",
    readStep:
      "Already running? It was printed once, right after the log says the API is protected.",
    readCommandLabel: "Read the boot log",
    readCommand: "docker compose -f deploy/compose.yaml logs -f",
    generateStep: "Missed it, or starting fresh? Set a new one from the control plane machine.",
    generateCommandLabel: "Generate a token",
    generateCommand:
      "docker compose -f deploy/compose.yaml exec control-plane node scripts/operator-token.mjs",
    generateDev: "On a development clone: make operator-token.",
    pasteHint: "Paste it below.",
  },

  /** The wait while the server is asked whether a session exists. A sentence and not a blank: the
   *  first load goes through here, and half a second of white screen reads as a failure. */
  checking: "Checking the session…",

  signOut: "Sign out",
});
