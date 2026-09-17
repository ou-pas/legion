// A grid of "big number plus small label" tiles is a banned page structure: the default variant is
// `inline`, a measure in a dense instrument bar separated by lines. `tile` is still possible inside
// a card, with no surface of its own. The value goes through <Num>: mono, tabular figures, locale
// grouping.
import type { ReactNode } from "react";
import { Num, type NumTone } from "./num.js";
import "./stat.css";

export type StatVariant = "inline" | "tile";

export function Stat({
  label,
  value,
  prefix,
  suffix,
  hint,
  trend,
  variant = "inline",
  tone,
  className,
  id,
}: {
  label: ReactNode;
  /** A number or string goes through `<Num>`; a node renders as is. */
  value: ReactNode;
  prefix?: string;
  suffix?: string;
  /** Detail under the value: "across 8 sessions", "reset at 14:09". */
  hint?: ReactNode;
  /** Change next to the value, typically `<Num variant="delta">`. */
  trend?: ReactNode;
  variant?: StatVariant;
  tone?: NumTone;
  className?: string;
  id?: string;
}) {
  const measure =
    typeof value === "number" || typeof value === "string" ? (
      <Num value={value} prefix={prefix} suffix={suffix} tone={tone} />
    ) : (
      value
    );
  return (
    <div
      id={id}
      className={["ui-stat", className].filter(Boolean).join(" ")}
      data-variant={variant}
    >
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-line">
        <span className="ui-stat-value">{measure}</span>
        {trend != null && <span className="ui-stat-trend">{trend}</span>}
      </span>
      {hint != null && <span className="ui-stat-hint">{hint}</span>}
    </div>
  );
}

/** A dense row separated by lines, like an instrument. `tile` switches to a grid when each measure
 *  needs air. */
export function StatGroup({
  label,
  variant = "inline",
  className,
  children,
}: {
  label?: string;
  variant?: StatVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-stat-group", className].filter(Boolean).join(" ")}
      data-variant={variant}
      role={label == null ? undefined : "group"}
      aria-label={label}
    >
      {children}
    </div>
  );
}
