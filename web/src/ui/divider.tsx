// With a label, the line runs behind the text (continuous) instead of being cut in two.
import type { ReactNode } from "react";
import "./divider.css";

export function Divider({
  orientation = "horizontal",
  label,
  labelCase = "caps",
  surface = "sheet",
  space = "md",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  /** Horizontal only. */
  label?: ReactNode;
  /** `caps` treats the label as a section label. `sentence` keeps it as written, for proper names
   *  or sentences that capitals distort: "PERSONAL ACCESS TOKEN" is not the token's name at the
   *  provider. */
  labelCase?: "caps" | "sentence";
  /** The surface under the line: the label must blend into it so the line shows. */
  surface?: "sheet" | "paper" | "recess";
  space?: "none" | "sm" | "md" | "lg";
  className?: string;
}) {
  const labelled = orientation === "horizontal" && label != null;
  return (
    <div
      className={["ui-divider", className].filter(Boolean).join(" ")}
      // A separator carrying text is not an ARIA `separator` (its content is read): the role
      // goes on the silent line only.
      role={labelled ? undefined : "separator"}
      aria-orientation={labelled ? undefined : orientation}
      data-orientation={orientation}
      data-space={space}
      data-surface={surface}
      data-labelled={labelled ? "true" : undefined}
      data-label-case={labelled ? labelCase : undefined}
    >
      {labelled && <span className="ui-divider-label">{label}</span>}
    </div>
  );
}
