// Two shapes: one line (list row titles, paths) or 2-3 lines (task descriptions on a board card).
import type { ReactNode } from "react";
import { useTooltipTrigger, type TooltipSide } from "./use-tooltip.js";
import { useTruncated } from "./use-truncated.js";
import "./ellipsis.css";

export function Ellipsis({
  lines = 1,
  as: Tag = "span",
  side,
  title,
  className,
  children,
}: {
  lines?: 1 | 2 | 3;
  as?: "span" | "div" | "p";
  /** Overrides the inferred text (rare: `children` almost always carries the full text). */
  title?: string;
  /** Pass `"left"`/`"right"` in a dense list (~30px rows) so the tooltip does not cover the next
   *  row. */
  side?: TooltipSide;
  className?: string;
  children: ReactNode;
}) {
  const label = title ?? (typeof children === "string" ? children : undefined);
  // Measured, not assumed: one shared ResizeObserver (use-truncated.ts) says whether this node
  // really overflows, so no tooltip on text that fits.
  const { ref: measureRef, truncated } = useTruncated<HTMLElement>(lines > 1, children);
  const active = truncated && label !== undefined;

  // The hook attaches to the measured Tag itself: a wrapping span broke `min-width: 0` in a flex
  // row and the text overflowed instead of truncating (see `use-tooltip.tsx`).
  const { anchorRef, triggerProps, describedById, bubble } = useTooltipTrigger({
    label: label ?? "",
    side,
  });

  const setRef = (node: HTMLElement | null) => {
    measureRef.current = node;
    anchorRef.current = node;
  };

  return (
    <Tag
      ref={setRef}
      className={["ui-ellipsis", className].filter(Boolean).join(" ")}
      data-lines={lines}
      {...(active ? { ...triggerProps, "aria-describedby": describedById } : null)}
    >
      {children}
      {active && bubble}
    </Tag>
  );
}
