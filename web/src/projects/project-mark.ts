// A project's mark: two letters and a hue, derived.
//
// A pure function: the same name/id pair always gives the same mark, on any machine, with nothing
// stored. The hue comes from the id and the letters from the name, and that is the point: renaming
// changes the initials without moving the colour, so an eye that learned "the brick square is that
// one" keeps it. Two projects with close names ("kopee" / "kopee-web") have different ids, so
// different colours.

/** The number of steps in the hue scale declared in `ui/tokens.css` (`--prj-hue-0` …
 *  `--prj-hue-11`). Here because the projection happens in JS; a step's value never enters the TSX:
 *  `hue` is a rank on the scale, not a colour. */
export const PROJECT_HUES = 12;

export type ProjectMark = {
  /** Two uppercase characters. "?" when the name has no significant character. */
  initials: string;
  /** Rank on the hue scale: 0 … PROJECT_HUES - 1. */
  hue: number;
};

/** Significant = letter or digit. Spaces, dots and dashes carry nothing to the eye, and keeping
 *  them would render "Kopee.me" as "KO" and "K. Me" as "K.", two marks for one naming logic. `\p{L}`
 *  covers accents and non-Latin alphabets. */
const SIGNIFICANT = /[\p{L}\p{N}]/u;

function initialsOf(name: string): string {
  const kept = [...name]
    .filter((c) => SIGNIFICANT.test(c))
    .slice(0, 2)
    .join("");
  return kept ? kept.toUpperCase() : "?";
}

/** FNV-1a 32-bit: stable everywhere, four lines, no dependency. Not cryptographic and need not be:
 *  it spreads twelve squares, it signs nothing. `>>> 0` each round: without it `Math.imul` returns a
 *  signed integer and the modulo can yield a negative rank, so a `data-hue` no CSS rule targets. */
function hueOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % PROJECT_HUES;
}

/** `chosen` is the hue set by hand in project settings (`projects.hue`, v47). It replaces the
 *  derived one when present and gives it back when removed, hence an optional third argument rather
 *  than a second entry point: callers unaware of the choice keep rendering the same mark.
 *
 *  An out-of-scale rank is ignored. The route already refuses it (v47), so it cannot come from the
 *  screen, only from a hand-edited database, and the square would be colourless (CSS only targets
 *  `[data-hue="0"]` … `[data-hue="11"]`). Falling back to the derived hue shows a wrong colour;
 *  showing nothing leaves a white hole in the rail. */
export function projectMark(name: string, id: string, chosen?: number | null): ProjectMark {
  const valid =
    typeof chosen === "number" && Number.isInteger(chosen) && chosen >= 0 && chosen < PROJECT_HUES;
  return { initials: initialsOf(name), hue: valid ? chosen : hueOf(id) };
}
