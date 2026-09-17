// The <label> always wraps the control: one target of at least 24px, no dead zone between box
// and label.
import { createContext, use, useId, type ReactNode } from "react";
import "./choice.css";

/* Check and dot are drawn (SVG): `accent-color` gives a blue Chrome box or a grey Safari one,
   with a radius and stroke weight from no design system. The native input stays in the DOM,
   visually hidden but functional (keyboard, screen readers, form validation). */
function CheckGlyph() {
  return (
    <svg className="ui-choice-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.4 6.4 11.3 12.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

export function Checkbox({
  checked,
  onChange,
  disabled = false,
  indeterminate = false,
  className,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Partial state ("some repos granted"): the box shows a dash, not a check. */
  indeterminate?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={["ui-choice", className].filter(Boolean).join(" ")}>
      <span className="ui-choice-slot">
        <input
          type="checkbox"
          className="ui-choice-input"
          checked={checked}
          disabled={disabled}
          aria-checked={indeterminate ? "mixed" : checked}
          ref={(el) => {
            // `indeterminate` exists only on the node, no HTML attribute carries it.
            // oxlint-disable-next-line no-param-reassign -- DOM API, not a model object
            if (el) el.indeterminate = indeterminate;
          }}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-choice-box" data-shape="square" aria-hidden="true">
          {indeterminate ? <span className="ui-choice-dash" /> : <CheckGlyph />}
        </span>
      </span>
      <span className="ui-choice-text">{children}</span>
    </label>
  );
}

type Group = { name: string; value: string; onChange: (next: string) => void };
const GroupCtx = createContext<Group | null>(null);
/** A Radio outside a group stays inert rather than crashing. */
const ORPHAN: Group = { name: "", value: "", onChange: () => {} };

export function RadioGroup({
  label,
  name,
  value,
  onChange,
  className,
  children,
}: {
  label: ReactNode;
  name: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <GroupCtx value={{ name, value, onChange }}>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={["ui-radiogroup", className].filter(Boolean).join(" ")}
      >
        <span className="ui-radiogroup-label" id={labelId}>
          {label}
        </span>
        <div className="ui-radiogroup-items">{children}</div>
      </div>
    </GroupCtx>
  );
}

/** A radio's mark alone, without the `<label>`. Split out of `Radio` on 07/09 for
 *  `ui/option-card.tsx`: a label inside a label is not valid HTML, so the card carries its own.
 *  One radio drawing in the app, whatever frames it. */
export function RadioMark({
  name,
  value,
  checked,
  disabled = false,
  onChange,
}: {
  name?: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <span className="ui-choice-slot">
      <input
        type="radio"
        className="ui-choice-input"
        name={name || undefined}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="ui-choice-box" data-shape="round" aria-hidden="true">
        <span className="ui-choice-dot" />
      </span>
    </span>
  );
}

export function Radio({
  value,
  disabled = false,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const group = use(GroupCtx) ?? ORPHAN;
  return (
    <label className={["ui-choice", className].filter(Boolean).join(" ")}>
      <RadioMark
        name={group.name}
        value={value}
        checked={group.value === value}
        disabled={disabled}
        onChange={() => group.onChange(value)}
      />
      <span className="ui-choice-text">{children}</span>
    </label>
  );
}

/** `accent-color` cannot produce this shape. */
export function Switch({
  checked,
  onChange,
  disabled = false,
  className,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <label className={["ui-switch", className].filter(Boolean).join(" ")}>
      <span className="ui-switch-slot">
        <input
          type="checkbox"
          role="switch"
          className="ui-switch-input"
          checked={checked}
          aria-checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-switch-track" aria-hidden="true">
          <span className="ui-switch-knob" />
        </span>
      </span>
      {children && <span className="ui-choice-text">{children}</span>}
    </label>
  );
}
