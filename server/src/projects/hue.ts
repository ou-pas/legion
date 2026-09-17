// A project's chosen hue (v47): what the route accepts to write into `projects.hue`.
//
// Three legitimate inputs: a step of the scale, `null` to remove the choice and fall back to
// derivation, and a missing key to change nothing. The route tells the last two apart
// (`body.hue === undefined` never reaches here); this module tells the first two apart.
//
// The step is validated, like `modelRouting`: an out-of-scale step is a square with no colour, since
// CSS targets `[data-hue="0"]` … `[data-hue="11"]` only. The failure would be silent and far away.

/** Scale steps, declared in `web/src/ui/tokens.css` (`--prj-hue-0` … `--prj-hue-11`) and repeated
 *  in `web/src/projects/project-mark.ts`. Copied rather than shared: the two halves have no common
 *  module, and one constant is not worth a package. */
export const PROJECT_HUES = 12;

export type HueInput = { ok: true; value: number | null } | { ok: false; error: string };

/** `null` clears the choice, an integer 0..11 sets it. Anything else is refused by name: a "3"
 *  string comes from a miswired `<select>`, a 12 from a scale believed wider. */
export function validateHueInput(input: unknown): HueInput {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "number" || !Number.isInteger(input))
    return { ok: false, error: "hue must be an integer or null" };
  if (input < 0 || input >= PROJECT_HUES)
    return { ok: false, error: `hue must be between 0 and ${PROJECT_HUES - 1}` };
  return { ok: true, value: input };
}
