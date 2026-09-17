// The vocabulary of a project's hue (v47).
//
// THE TWELVE NAMES ARE THE POINT OF THIS FILE. A color swatch has no accessible name: to a screen
// reader, twelve untitled squares are twelve "unlabeled" cells, so an unusable picker. The names
// come from the comments on the scale in `ui/tokens.css`, where they were already written for the
// humans who read the CSS — they simply move down to where they also serve those who never
// reach it.
import { defineText } from "../../i18n/catalog.js";

export const HUE_TEXT = defineText({
  legend: "Project color",
  desc: "The color of the square in the rail. By default it is derived from the project id, which is enough while there are only two or three.",
  /** The thirteenth choice, and the only one that is not a color: it REMOVES the choice. */
  auto: "Automatic",
  autoHint: (name: string) => `Automatic — ${name}, derived from the id`,
  /** What the screen reader announces on the swatch the rule would have picked. */
  derived: (name: string) => `${name} (derived color)`,
  saveFailed: "The color could not be saved",
  name: {
    "0": "Vermilion",
    "1": "Olive",
    "2": "Fir",
    "3": "Slate",
    "4": "Plum",
    "5": "Garnet",
    "6": "Ochre",
    "7": "Brick",
    "8": "Moss",
    "9": "Teal",
    "10": "Violet ink",
    "11": "Terracotta",
  },
});

/** The name of a rank. A function and not a direct access: the rank comes from a computation
 *  (the derivation hash), so TypeScript cannot prove it is in the catalog. */
export function hueName(rank: number): string {
  return HUE_TEXT.name[String(rank) as keyof typeof HUE_TEXT.name] ?? HUE_TEXT.auto;
}
