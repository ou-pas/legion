// Label/value pairs aligned on a shared column. A real `<dl>`: the key↔value relation is in the
// HTML.
import type { ReactNode } from "react";
import "./key-value.css";

export type KeyValueVariant = "aligned" | "stacked";

export function KeyValueList({
  variant = "aligned",
  density = "comfortable",
  label,
  className,
  children,
}: {
  /** `aligned` = two columns sized on the widest key · `stacked` = key above (narrow rail). */
  variant?: KeyValueVariant;
  density?: "comfortable" | "compact";
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl
      className={["ui-kv-list", className].filter(Boolean).join(" ")}
      data-variant={variant}
      data-density={density}
      aria-label={label}
    >
      {children}
    </dl>
  );
}

/** The wrapper is `display: contents` so the list grid aligns every value on one column whatever
 *  the key lengths. */
export function KeyValue({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["ui-kv", className].filter(Boolean).join(" ")}>
      <dt className="ui-kv-key">
        {label}
        {hint != null && <span className="ui-kv-hint">{hint}</span>}
      </dt>
      <dd className="ui-kv-val">{children}</dd>
    </div>
  );
}
