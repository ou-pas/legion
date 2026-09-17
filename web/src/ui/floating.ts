// Shared mechanics of anchored floating surfaces (Menu, Popover): anchor point in viewport
// coordinates, flipped when the surface would overflow, and dismissal on Escape / outside click.
// No rendering here: components own their markup, this module owns the geometry.
import { useEffect, useLayoutEffect, useState } from "react";

export type Side = "bottom" | "top";
export type Align = "start" | "end";
export interface Point {
  top: number;
  left: number;
  /** `maxSurfaceWidth()` at placement time. Each caller combines it with its own design cap via
   *  `min()` in CSS (`--surface-max-w`): the window bounds the worst case, it does not replace the
   *  visual cap a menu keeps on a large screen. */
  maxWidth: number;
}

const GAP = 6; // anchor ↔ surface gap
const EDGE = 8; // minimum margin to the viewport edge

const clamp = (v: number, max: number) => Math.min(Math.max(v, EDGE), Math.max(EDGE, max - EDGE));

/** Width a floating surface can use before leaving the window, `EDGE` margin included on both
 *  sides. `clamp` bounded a surface's point, never its size: a long option label widened it off
 *  the right edge (measured: 393px in a 375px window). Separate from `useAnchoredPoint` because
 *  `select.tsx` and `combobox.tsx` need it on first render, before the point can be computed. */
export const maxSurfaceWidth = () => window.innerWidth - 2 * EDGE;

/** An object rather than five positional arguments: `useAnchoredPoint(a, s, open, "bottom",
 *  "start")` did not say which of the last two was the side. */
export interface AnchoredPoint {
  anchor: HTMLElement | null;
  surface: HTMLElement | null;
  open: boolean;
  side?: Side;
  align?: Align;
}

/** Requested side if it fits, otherwise the other one, then clamped to the viewport. */
export function useAnchoredPoint({
  anchor,
  surface,
  open,
  side = "bottom",
  align = "start",
}: AnchoredPoint): Point | null {
  const [point, setPoint] = useState<Point | null>(null);
  // Layout effect: measured and placed before paint, so the surface never shows in the wrong spot.
  useLayoutEffect(() => {
    if (!open || !anchor || !surface) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const s = surface.getBoundingClientRect();
      const below = a.bottom + GAP;
      const above = a.top - s.height - GAP;
      const fits =
        side === "bottom" ? below + s.height <= window.innerHeight - EDGE : above >= EDGE;
      const wanted = side === "bottom" ? below : above;
      const top = clamp(
        fits ? wanted : side === "bottom" ? above : below,
        window.innerHeight - s.height,
      );
      const left = clamp(
        align === "start" ? a.left : a.right - s.width,
        window.innerWidth - s.width,
      );
      const maxWidth = maxSurfaceWidth();
      setPoint((p) =>
        p && p.top === top && p.left === left && p.maxWidth === maxWidth
          ? p
          : { top, left, maxWidth },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // capture: container scrolls count too
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, surface, side, align]);
  return open ? point : null;
}

/** Escape and clicks outside anchor and surface close. No focus trap: non-modal. `onClose`
 *  receives `true` when closing came from the keyboard, the only case where focus must return to
 *  the trigger (after a click elsewhere it would steal the user's focus). */
export function useDismiss(
  open: boolean,
  onClose: (viaKeyboard: boolean) => void,
  anchor: HTMLElement | null,
  surface: HTMLElement | null,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (t: EventTarget | null) =>
      t instanceof Node && !anchor?.contains(t) && !surface?.contains(t);
    // mousedown, not click: a text selection ending outside must not close.
    const onDown = (e: MouseEvent) => {
      if (outside(e.target)) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor, surface]);
}

/** Focus movement in a list (menu): wrapping arrows, Home/End. */
export function moveFocus(items: HTMLElement[], from: number, key: string): boolean {
  if (items.length === 0) return false;
  const last = items.length - 1;
  const next =
    key === "ArrowDown"
      ? from >= last
        ? 0
        : from + 1
      : key === "ArrowUp"
        ? from <= 0
          ? last
          : from - 1
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : -1;
  if (next < 0) return false;
  items[next]?.focus();
  return true;
}
