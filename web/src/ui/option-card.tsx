// Exclusive choice where each option has a label, a reason under it, and sometimes a badge
// ("recommended"). The options grammar of the inbox-decoupes.html mockup (07/09): a bordered card,
// the design system's radio mark on the left, the chosen card takes the accent wash.
//
// Neither `RadioGroup` (inline radios, no reason or badge) nor `OptionList` (buttons that send on
// click, no lasting selection): here you choose, reread, change your mind, and sending comes
// later. The domain fills the slots; this module does not know "recommended".
import { useId, type ReactNode } from "react";
import { RadioMark } from "./choice.js";
import "./option-card.css";

export type OptionCardItem = {
  id: string;
  label: ReactNode;
  /** The reason, muted under the label: why you would pick this one. */
  why?: ReactNode;
  /** The caller decides what it means. */
  badge?: ReactNode;
};

export function OptionCards({
  options,
  value,
  onChange,
  labelledBy,
  label,
  disabled = false,
  layout = "stack",
  className,
}: {
  options: readonly OptionCardItem[];
  value: string | null;
  onChange: (id: string) => void;
  /** Id of the heading naming the group (a `Heading` above), or an accessible label. */
  labelledBy?: string;
  label?: string;
  disabled?: boolean;
  /** `row`: cards sit side by side when there is room (short options). */
  layout?: "stack" | "row";
  className?: string;
}) {
  // Two open groups may share option ids: `name` is unique per render so groups do not steal each
  // other's selection.
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={["ui-optcards", className].filter(Boolean).join(" ")}
      data-layout={layout}
    >
      {options.map((o) => (
        <label key={o.id} className="ui-optcard" data-disabled={disabled ? "true" : undefined}>
          <RadioMark
            name={name}
            value={o.id}
            checked={value === o.id}
            disabled={disabled}
            onChange={() => onChange(o.id)}
          />
          <span className="ui-optcard-body">
            <span className="ui-optcard-label">
              {o.label}
              {o.badge}
            </span>
            {o.why && <span className="ui-optcard-why">{o.why}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
