// The text of the red-CI watch switch on the Repositories tab (29/09): what watching CI means and
// what happens once the automatic attempts run out.
import { defineText } from "../../i18n/catalog.js";

export const CI_WATCH_CARD_TEXT = defineText({
  title: "CI watch",
  why:
    "Every 5 minutes, a red CI on an open PR of a task in review relaunches Fix CI automatically, " +
    "up to 3 attempts. Once the attempts run out, a notification replaces the retry.",
  switchLabel: "Watch CI on this project's open PRs",
});
