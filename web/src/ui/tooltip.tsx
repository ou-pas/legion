// The app's single tooltip mechanism (replaced the raw native `title`, 20/08 audit). Entry point for
// everything except measured truncated text (`Ellipsis` attaches the same engine to its own node,
// see `use-tooltip.tsx`). Hover and focus, open delay, side flipping, viewport clamping, a real
// `aria-describedby`, and a `disabled` child stays explainable: a disabled control emits neither
// pointer nor focus events, so the wrapper listens and becomes focusable, never the control.
import { cloneElement, isValidElement, type ReactNode, type RefObject } from "react";
import { useTooltipTrigger, type TooltipSide } from "./use-tooltip.js";

export type { TooltipSide };

type Described = { "aria-describedby"?: string };
type MaybeDisabled = { disabled?: boolean };

export function Tooltip({
  label,
  side,
  delay,
  className,
  children,
}: {
  label: ReactNode;
  /** Preferred side; flips to the opposite when there is no room. `"top"` by default. */
  side?: TooltipSide;
  /** Hover open delay (ms); 140 by default. */
  delay?: number;
  className?: string;
  /** A single element. If it is `disabled` the tooltip still opens, on hover and keyboard, because
   *  the wrapper listens (detected automatically). */
  children: ReactNode;
}) {
  const disabled = isValidElement<MaybeDisabled>(children) && children.props.disabled === true;
  const { anchorRef, triggerProps, describedById, bubble } = useTooltipTrigger({
    label,
    side,
    delay,
    disabled,
  });

  // Enabled control: aria-describedby goes on it (name and description stay linked). Disabled
  // control: it is inert for accessibility (Tab never reaches it), so the wrapper carries tabIndex,
  // the description and the name too: a generic span with no text of its own (an icon inside)
  // would otherwise have nothing to announce.
  const described = isValidElement<Described>(children)
    ? cloneElement(children, disabled ? undefined : { "aria-describedby": describedById })
    : children;

  return (
    <span
      ref={anchorRef as RefObject<HTMLSpanElement | null>}
      className={["ui-tooltip-anchor", className].filter(Boolean).join(" ")}
      aria-describedby={disabled ? describedById : undefined}
      aria-label={disabled && typeof label === "string" ? label : undefined}
      {...triggerProps}
    >
      {described}
      {bubble}
    </span>
  );
}
