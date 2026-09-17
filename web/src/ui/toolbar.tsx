// Two explicit overflow strategies: `wrap` (the bar wraps, nothing disappears) or `scroll` (one
// scrolling line, the thin scrollbar is the cue).
import type { KeyboardEvent, ReactNode } from "react";
import "./toolbar.css";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Left/right arrows between actions, as expected from `role="toolbar"`. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const from = items.indexOf(document.activeElement as HTMLElement);
  if (from < 0 || items.length < 2) return;
  const step = e.key === "ArrowRight" ? 1 : items.length - 1;
  items[(from + step) % items.length]?.focus();
  e.preventDefault();
}

export function Toolbar({
  label,
  align = "start",
  overflow = "wrap",
  variant = "plain",
  end,
  className,
  children,
}: {
  /** Bar name for screen readers ("Task actions"). */
  label: string;
  align?: "start" | "end" | "between";
  overflow?: "wrap" | "scroll";
  variant?: "plain" | "ruled" | "bar";
  /** Actions pushed to the right (destructive, secondary). */
  end?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-toolbar", className].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-align={align}
      data-overflow={overflow}
      data-variant={variant}
      onKeyDown={moveFocus}
    >
      {children}
      {end != null && <span className="ui-toolbar-end">{end}</span>}
    </div>
  );
}
