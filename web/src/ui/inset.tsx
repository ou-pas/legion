// Recessed block inside a card (collapsed add form, preview, subtotal). Exists so a card is never
// nested in a card: the recess reads as "one step below", not as a second sheet.
import type { ReactNode } from "react";
import "./inset.css";

export function Inset({
  label,
  tone = "recess",
  stretch = false,
  className,
  children,
}: {
  /** Block title, in small caps. */
  label?: ReactNode;
  /** `recess` = neutral recess · `accent` = waiting for an operator decision. */
  tone?: "recess" | "accent";
  /** The body (everything but the label) fills the recess's remaining height instead of stopping
   *  at its own content. For a frame already stretched by its parent whose body must cover the
   *  rest, like a board drop zone. */
  stretch?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-inset", stretch && "ui-inset--stretch", className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      {label != null && <div className="ui-inset-label">{label}</div>}
      {children}
    </div>
  );
}
