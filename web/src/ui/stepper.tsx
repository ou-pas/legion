// A bounded quantity in small steps, one click per step (−/+).
//
// Born with the Runners redesign (direction-runners.html, variant A, 02/09): session and CPU caps
// are values between 1 and 16 adjusted one step at a time; a bare number field takes click, erase,
// type, confirm to go from 2 to 3.
//
// Controlled and silent: it renders `value`, calls `onChange`, and knows nothing about saving (the
// caller's job, ui/save-button.tsx). That keeps it reusable for a filter, pagination, a setting.
//
// Keyboard: the value is a focusable `spinbutton` (up/down for a step, Home/End for bounds). Both
// buttons stay clickable but leave the tab order: one tab stop per stepper, not three.
import { Minus, Plus } from "lucide-react";
import { UI_TEXT } from "./vocabulary.js";
import "./stepper.css";

export function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  label,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the value, muted: "MB", "core". */
  unit?: string;
  /** Name of the quantity for screen readers ("Concurrent mini-workshop sessions"). */
  label: string;
  /** Formats the displayed value (default: as is). */
  format?: (n: number) => string;
  onChange: (n: number) => void;
}) {
  // Floats with a 0.25 step drift (0.1 + 0.2 …): snap to the nearest step so ten clicks on + do not
  // produce 2.7500000000000004.
  const snap = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const set = (n: number) => onChange(Number(snap(n).toFixed(4)));

  return (
    <span className="ui-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="ui-stepper-btn"
        tabIndex={-1}
        aria-label={UI_TEXT.stepDown(label)}
        disabled={value <= min}
        onClick={() => set(value - step)}
      >
        <Minus size={12} />
      </button>
      <span
        className="ui-stepper-value"
        role="spinbutton"
        tabIndex={0}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={label}
        aria-valuetext={`${format ? format(value) : value}${unit ? ` ${unit}` : ""}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            set(value + step);
          }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            set(value - step);
          }
          if (e.key === "Home") {
            e.preventDefault();
            set(min);
          }
          if (e.key === "End") {
            e.preventDefault();
            set(max);
          }
        }}
      >
        {format ? format(value) : value}
        {unit && <span className="ui-stepper-unit">{unit}</span>}
      </span>
      <button
        type="button"
        className="ui-stepper-btn"
        tabIndex={-1}
        aria-label={UI_TEXT.stepUp(label)}
        disabled={value >= max}
        onClick={() => set(value + step)}
      >
        <Plus size={12} />
      </button>
    </span>
  );
}
