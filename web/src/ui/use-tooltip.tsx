// Tooltip positioning engine without its own rendering, extracted so `Ellipsis` can attach it
// directly to its own node: a wrapper around truncated text in a flex row breaks shrinking
// (`min-width: 0` must stay on the measured node). `Tooltip` (tooltip.tsx) remains the entry point
// for everything else (controls, links): it needs the wrapper to listen for a `disabled` child.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./tooltip.css";

export type TooltipSide = "top" | "bottom" | "left" | "right";

// Pixel geometry: it lives in getBoundingClientRect, not in a stylesheet.
const OPEN_DELAY = 140; // ms, enough not to flicker when crossing a toolbar
const GAP = 6; // gap between anchor and bubble
const EDGE = 8; // minimum margin to the viewport edge

interface Pos {
  x: number;
  y: number;
  side: TooltipSide;
}

const OPPOSITE: Record<TooltipSide, TooltipSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

// Focus only opens the bubble when it is visible (07/09): the one Tab leaves, not one set by a
// script (`useDialogA11y` opening a modal) or following a click. Otherwise a modal without
// `data-autofocus` opened with "Close" shown under its close button. The element that received focus
// (`event.target`) is queried, not the listening wrapper: `:focus-visible` does not propagate to
// ancestors. An engine that does not know the selector (old jsdom) throws: then it opens.
function isVisibleFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return true;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

// The preferred side wins if it fits; otherwise flip to the opposite, never to the perpendicular
// axis.
function computePos(a: DOMRect, b: DOMRect, preferred: TooltipSide): Pos {
  const fits: Record<TooltipSide, boolean> = {
    top: a.top - b.height - GAP >= EDGE,
    bottom: a.bottom + b.height + GAP <= window.innerHeight - EDGE,
    left: a.left - b.width - GAP >= EDGE,
    right: a.right + b.width + GAP <= window.innerWidth - EDGE,
  };
  const side = fits[preferred]
    ? preferred
    : fits[OPPOSITE[preferred]]
      ? OPPOSITE[preferred]
      : preferred;

  if (side === "top" || side === "bottom") {
    const maxX = Math.max(EDGE, window.innerWidth - b.width - EDGE);
    return {
      x: Math.min(Math.max(a.left + a.width / 2 - b.width / 2, EDGE), maxX),
      y: side === "top" ? a.top - b.height - GAP : a.bottom + GAP,
      side,
    };
  }
  const maxY = Math.max(EDGE, window.innerHeight - b.height - EDGE);
  return {
    x: side === "left" ? a.left - b.width - GAP : a.right + GAP,
    y: Math.min(Math.max(a.top + a.height / 2 - b.height / 2, EDGE), maxY),
    side,
  };
}

export interface UseTooltipOptions {
  /** Short: an action name, a path, a reason. Not a paragraph. */
  label: ReactNode;
  /** Preferred side, flipping to the opposite when there is no room, never to the other axis.
   *  `"top"` by default. In a dense list (~30px rows) `"left"`/`"right"` avoids covering the next
   *  row: top/bottom presses the bubble against it, a lateral side only overlaps the next column. */
  side?: TooltipSide;
  /** Hover open delay in ms, 140 by default. Keyboard ignores it (opens immediately on focus): a
   *  delay only makes sense for a hover passing through. */
  delay?: number;
  /** Listens on the wrapper rather than the target and makes the wrapper focusable. A `disabled`
   *  control emits neither pointer nor focus events (it cannot even receive Tab): without this mode
   *  its tooltip would never open. */
  disabled?: boolean;
}

/** Open state, measurement, portal. Both attachment points (`Tooltip`, `Ellipsis`) put
 *  `triggerProps` on different nodes but share exactly this logic. */
export function useTooltipTrigger({
  label,
  side = "top",
  delay = OPEN_DELAY,
  disabled = false,
}: UseTooltipOptions) {
  const id = useId();
  const anchorRef = useRef<HTMLElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);
  const openNow = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(true);
  }, []);
  const openSoon = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Placed once it exists: the measuring ref receives it already mounted (invisible until
  // data-ready), so its real size tells which side it fits on and allows clamping it into the
  // viewport when the anchor is at the edge.
  const place = useCallback(
    (node: HTMLDivElement | null) => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!node || !a) return;
      setPos(computePos(a, node.getBoundingClientRect(), side));
    },
    [side],
  );

  // A pixel-placed bubble does not follow its anchor: if the page moves under it, it closes.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const triggerProps = {
    // Pointer events, and mouse only (14/09). iOS synthesises `mouseenter` on a finger press and never
    // sends the matching `mouseleave`, so the bubble stayed on screen until the next scroll
    // (reported on a task's panel). A tooltip is a hover mechanism; on touch the label is still
    // carried by `aria-label`/`aria-describedby`.
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") openSoon();
    },
    onPointerLeave: close,
    // A cancelled pointer (the system takes over the gesture: scroll, edge swipe back) produces no
    // `leave`. Without this the bubble would survive an interrupted gesture.
    onPointerCancel: close,
    // A click answered the question the bubble was asking. And if the click opens a surface over the
    // anchor, `leave` never arrives: the second way a bubble stayed stuck, on desktop this time.
    onPointerDown: close,
    onFocus: (e: FocusEvent) => {
      if (isVisibleFocus(e.target)) openNow();
    },
    onBlur: close,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    // Otherwise a `disabled` child (unreachable by keyboard) has no way to open its own tooltip: Tab
    // must be able to stop on the wrapper itself.
    ...(disabled ? { tabIndex: 0 } : null),
  };

  const describedById = open ? id : undefined;

  const bubble =
    open &&
    createPortal(
      <div
        ref={place}
        // oxlint-disable-next-line react/forbid-dom-props -- pixel position (getBoundingClientRect)
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        id={id}
        role="tooltip"
        className="ui-tooltip"
        data-side={pos?.side ?? side}
        data-ready={pos ? "true" : undefined}
      >
        {label}
      </div>,
      document.body,
    );

  return { anchorRef, triggerProps, describedById, bubble };
}
