// A project's colour, chosen rather than endured (nav project, slice 05).
//
// Derivation stays the default: a new project gets its mark with nobody doing anything, and adding
// a choice must not lose that. Hence a thirteenth button, "Automatic", which is not a colour but
// the removal of the choice; without it an unlucky click would be final.
//
// A group of native radio buttons, not clickable `div`s. Twelve targets without a radio role are
// tabbed one by one, are not announced as an exclusive choice, and ignore arrows. The browser gives
// all that for the price of an `<input type="radio">` hidden under the swatch, including the
// `<fieldset>` whose `<legend>` names the group.
//
// Saving is immediate, no "Save" button: clicking a colour is the decision, there is nothing to
// review, unlike a typed name.
import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Card } from "../ui/card.js";
import { Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { PROJECT_HUES, projectMark } from "./project-mark.js";
import { HUE_TEXT, hueName } from "./text/hue.js";
import "./hue-picker.css";

const RANKS = Array.from({ length: PROJECT_HUES }, (_, i) => i);

/** The picker alone, without network: `value` is the chosen hue (`null` = none), `derived` the one
 *  the rule would give. Separate from the card so stories show its states without a query client. */
export function HuePicker({
  value,
  derived,
  onChange,
}: {
  value: number | null;
  derived: number;
  onChange: (next: number | null) => void;
}) {
  // `name` makes the group for the browser: two pickers on one screen sharing a name would share
  // their arrows.
  const name = useId();
  return (
    <fieldset className="hue-picker">
      <legend className="hue-picker-legend">{HUE_TEXT.legend}</legend>
      <div className="hue-picker-swatches">
        <label className="hue-swatch">
          <input
            type="radio"
            className="hue-swatch-input"
            name={name}
            checked={value === null}
            onChange={() => onChange(null)}
          />
          {/* The "automatic" swatch has no colour: it would say which, the derived one, so two
              identical squares for two different things. */}
          <span className="hue-swatch-chip" data-auto="true" aria-hidden="true" />
          <span className="hue-swatch-name">{HUE_TEXT.autoHint(hueName(derived))}</span>
        </label>
        {RANKS.map((rank) => (
          <label className="hue-swatch" key={rank}>
            <input
              type="radio"
              className="hue-swatch-input"
              name={name}
              checked={value === rank}
              onChange={() => onChange(rank)}
            />
            <span
              className="hue-swatch-chip"
              data-hue={rank}
              data-derived={rank === derived ? "true" : undefined}
              aria-hidden="true"
            />
            {/* The swatch's accessible name. Hidden to the eye, never to the reader: a colour does
                not announce itself. */}
            <span className="hue-swatch-name">
              {rank === derived ? HUE_TEXT.derived(hueName(rank)) : hueName(rank)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The settings card: the picker, wired to the project. It sits next to the name, because the
 *  square's colour and the name are the same thing: what you recognise in the rail. */
export function ProjectHueCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  // The derived hue is recomputed here with the rail's function: two formulas for one colour would
  // end up showing a "derived" swatch that is not.
  const derived = projectMark(project.name, project.id).hue;
  const save = (next: number | null) =>
    projectsApi
      .patchProject(project.id, { hue: next })
      .then(() => {
        setErr("");
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setErr(e.message));
  return (
    <Card icon={<Palette size={16} />} title={HUE_TEXT.legend} desc={HUE_TEXT.desc}>
      <Stack gap={8}>
        {err && <FormError>{`${HUE_TEXT.saveFailed} — ${err}`}</FormError>}
        <HuePicker value={project.hue} derived={derived} onChange={save} />
      </Stack>
    </Card>
  );
}
