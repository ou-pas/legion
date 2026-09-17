// Stepped slider: a quantity chosen among named stops; the position shows at a glance where you are
// between floor and ceiling.
//
// Born with the Runners redesign (direction-runners.html, variant A, 02/09): session RAM is chosen
// between 512 MB and 32 GB, but nobody wants 3,391 MB; useful values are stops (512, 1024, 2048…). A
// native `input type="range"` only snaps to a uniform step, so this one slides over the stop index
// (min=0, max=N-1, step=1) and shows the matching value. Keyboard, focus and screen readers are
// native; `aria-valuetext` says the real value instead of the index.
//
// A value outside the stops (set through the API, an old setting) is neither overwritten nor
// misreported: it is inserted in the scale at its place and the thumb sits on it.
import { useId } from "react";
import "./slider.css";

export function SnapSlider({
  value,
  stops,
  unit,
  label,
  format,
  onChange,
}: {
  value: number;
  /** Offered stops, ascending. */
  stops: readonly number[];
  unit?: string;
  /** Name of the quantity for screen readers. */
  label: string;
  format?: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const id = useId();
  const fmt = format ?? ((n: number) => String(n));
  const scale = stops.includes(value) ? [...stops] : [...stops, value].sort((a, b) => a - b);
  const idx = scale.indexOf(value);
  const pct = scale.length > 1 ? (idx / (scale.length - 1)) * 100 : 0;

  return (
    <span className="ui-slider">
      <input
        id={id}
        type="range"
        className="ui-slider-input"
        min={0}
        max={scale.length - 1}
        step={1}
        value={idx}
        aria-label={label}
        aria-valuetext={`${fmt(value)}${unit ? ` ${unit}` : ""}`}
        // Computed meter width, the lint's documented exception (same as ui/meter.tsx): the filled
        // part can only come from a computed value, passed as a CSS variable the track reads.
        // eslint-disable-next-line react/forbid-dom-props
        style={{ "--ui-slider-pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(scale[Number(e.target.value)]!)}
      />
      <span className="ui-slider-scale" aria-hidden="true">
        <span>{fmt(scale[0]!)}</span>
        <output htmlFor={id} className="ui-slider-current">
          {fmt(value)}
          {unit ? ` ${unit}` : ""}
        </output>
        <span>{fmt(scale[scale.length - 1]!)}</span>
      </span>
    </span>
  );
}
