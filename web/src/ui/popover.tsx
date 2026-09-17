// Non-modal anchored floating surface: an agent's grants preview, a date picker. Unlike Modal it
// neither traps focus nor locks the page. Escape and outside click close; position flips as needed.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPoint, useDismiss, type Align, type Side } from "./floating.js";
import "./popover.css";

const HOVER_GRACE = 140; // ms, time to cross the gap between anchor and surface

export function Popover({
  label,
  trigger,
  openOn = "click",
  side = "bottom",
  align = "start",
  triggerClassName,
  className,
  children,
}: {
  /** Accessible name of the surface and trigger. */
  label: string;
  trigger: ReactNode;
  /** hover = hover and keyboard focus on the trigger (preview) · click = explicit opening. */
  openOn?: "click" | "hover";
  side?: Side;
  align?: Align;
  triggerClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const surfaceId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const point = useAnchoredPoint({ anchor, surface, open, side, align });
  const close = useCallback(
    (viaKeyboard: boolean) => {
      setOpen(false);
      if (viaKeyboard) anchor?.focus();
    },
    [anchor],
  );
  useDismiss(open, close, anchor, surface);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hold = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const release = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), HOVER_GRACE);
  };
  const hover =
    openOn === "hover"
      ? { onMouseEnter: hold, onMouseLeave: release, onFocus: hold, onBlur: release }
      : {};
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? surfaceId : undefined}
        aria-label={label}
        className={["ui-popover-trigger", triggerClassName].filter(Boolean).join(" ")}
        onClick={() => {
          if (openOn === "click") setOpen((o) => !o);
        }}
        {...hover}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={setSurface}
            id={surfaceId}
            role="dialog"
            aria-label={label}
            className={["ui-popover", className].filter(Boolean).join(" ")}
            data-floating="true"
            data-placed={point ? "true" : undefined}
            /* `--surface-max-w` (floating.ts) bounds the window worst case; `popover.css` combines it
               with its own design cap via `min()`. */
            // oxlint-disable-next-line react/forbid-dom-props -- computed position and width
            style={
              point
                ? ({
                    top: point.top,
                    left: point.left,
                    "--surface-max-w": `${point.maxWidth}px`,
                  } as React.CSSProperties)
                : undefined
            }
            onMouseEnter={openOn === "hover" ? hold : undefined}
            onMouseLeave={openOn === "hover" ? release : undefined}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
