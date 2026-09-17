// The text of the SECRETS section: the project's encrypted keys and their labels.
//
// The resolution verdict ("this is the key that serves") is NOT here: it lives in
// `text/credentials.ts`, because the "Claude credentials" card reads it too.
import { defineText } from "../../i18n/catalog.js";

export const SECRETS_CARD_TEXT = defineText({
  title: "Project secrets",
  listLabel: "Project secrets",
  /** The description is CUT by three <code> elements (the two names that have a special effect,
   *  and the control plane's environment file): four pieces, in render order. */
  descBefore:
    "Encrypted in the database; the interface knows only their names — a secret is replaced, never read back. An agent reaches one only if you checked it on the Agents page (nothing by default). Two names have a special effect: ",
  descBetween: " and ",
  descAfter: " serve as Claude credentials ",
  descForThisProject: "for this project",
  descTail:
    ", instead of the control plane's — that is how a project runs on its own account. The subscription token wins over the API key. Provider tokens (GitHub, GitLab, Linear) are set from Integrations, by the button or by the paste field: there they are checked against the provider before being stored. This form still accepts them; it does not check them.",

  /** THE ONE-LINE NOTE ON WHAT SHOULD HAVE COME FROM ELSEWHERE. It removes nothing: a provider
   *  token already stored exists and serves, and no row is deleted from the database (the rule we
   *  gave ourselves with `LINEAR_API_KEY`). It only says where the gesture happens now, so that
   *  next time goes through the screen that probes and knows how to renew. */
  fromIntegrations: "Better set from Integrations",

  /** No secret: this is not a blank to fill, it is a state that works. The sentence says where
   *  the credentials come from instead. */
  emptyBefore: "No secret — this project uses the control plane's credentials (",
  emptyAfter: ").",

  remove: "Delete",
  removeConfirm: "Confirm deletion",
  /** The label, editable in place. Clearing the field REMOVES the label. */
  labelOf: (name: string) => `Label of ${name}`,
  labelPlaceholder: "name this key",

  nameLabel: "Name",
  nameHint: "In capitals, like an environment variable.",
  namePlaceholder: "e.g. ANTHROPIC_API_KEY",
  valueLabel: "Value",
  valueHint: "Sent once, encrypted on arrival, never read back.",
  valuePlaceholder: "paste the value",
  aliasLabel: "Label",
  aliasHint: "Optional — the account name, to tell which of your keys is which.",
  aliasPlaceholder: "e.g. Personal subscription",
  save: "Save the secret",

  /** Two distinct acknowledgements: a secret STORED and a secret REPLACED are not decided the
   *  same way, and not telling them apart suggests a second one was just created. */
  stored: (name: string) => `“${name}” saved`,
  replaced: (name: string) => `“${name}” replaced`,
});
