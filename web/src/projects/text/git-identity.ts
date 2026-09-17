// The text of the GIT IDENTITY card: the author of the commits an agent makes in this project,
// and the attribution verdict the forge sends back.
import { defineText } from "../../i18n/catalog.js";

export const GIT_IDENTITY_TEXT = defineText({
  title: "Git identity of commits",
  /** The description, cut around the two code chips: the git config it sets, then the defaults it
   *  falls back to. The warning at the end is what nobody guesses — a well-formed address is not
   *  an attributed address. */
  descBefore: "Name and email used by the commits agents make in this project (",
  descAfterConfig: "). An empty field falls back to the default —",
  descAfterDefaults:
    "— which attributes the commit to nobody on GitHub. The address must be a VERIFIED address of the account that owns the token: a valid address the forge does not know produces anonymous commits, without the slightest error message.",
  /** The verdict, in three states. The good one is a single quiet line, never a green banner. */
  verdict: {
    attachedBefore: "Commits attached",
    attachedTo: "to account",
    attachedAfter: "on the forge.",
    unlinkedTitle: "These commits will be attributed to nobody",
    unknownTitle: "Attribution cannot be verified",
    useSuggestion: (email: string) => `Use ${email}`,
  },
  nameLabel: "Author name",
  emailLabel: "Author email",
  defaultHint: (value: string) => `Default: ${value}`,
});
