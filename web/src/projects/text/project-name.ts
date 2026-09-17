// The text of the PROJECT NAME card, in the "Secrets & identity" tab.
import { defineText } from "../../i18n/catalog.js";

export const PROJECT_NAME_TEXT = defineText({
  title: "Project name",
  why:
    "The name shows everywhere and changes freely. The id below is computed from it, never " +
    "typed: it is also the name of the folder where the project's artifacts live, so it only " +
    "follows the name when there is nothing to move.",
  nameLabel: "Name",
  slugLabel: "Id",
  slugWhy: "Used as the folder name for artifacts, and as the file name of a crate export",
  candidateWhy: "What the new name would produce",
  arrow: "would become",
  maybe:
    "It will follow if the project has no session and its folder is empty, or if you chose an " +
    "explicit output folder. Otherwise it stays, and saving will tell you why.",
  moved: (slug: string) => `Renamed. The id followed: ${slug}.`,
  frozen: (reason: string) => `Renamed, but the id did not follow — ${reason}`,
  save: "Rename",
  saved: "Renamed",
});
