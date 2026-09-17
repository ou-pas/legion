// Content and its side column. The ratio is an explicit variant, not a free number: two ratios for
// the whole app.
import type { ReactNode } from "react";
import "./split.css";

export function SplitPane({
  ratio = "aside",
  side = "right",
  main,
  aside,
  label,
  className,
}: {
  /** `aside` = content plus narrow side column · `half` = two equally important panes. */
  ratio?: "aside" | "half";
  /** `left` is for navigation (a diff's file tree): you read the map before the content. DOM order
   *  does not change, so content stays first for the keyboard and on mobile. */
  side?: "left" | "right";
  main: ReactNode;
  aside: ReactNode;
  /** Side column name for screen readers ("Goal guardrails"). */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={["ui-split", className].filter(Boolean).join(" ")}
      data-ratio={ratio}
      data-side={side}
    >
      <div className="ui-split-main">{main}</div>
      <aside className="ui-split-aside" aria-label={label}>
        {aside}
      </aside>
    </div>
  );
}
