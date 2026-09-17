// Secondary actions of a session, a model choice. The surface is portalled into <body> (an
// overflow:hidden panel must not clip it), positioned with flipping, focus returned to the trigger
// on keyboard close.
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { moveFocus, useAnchoredPoint, useDismiss, type Align, type Side } from "./floating.js";
import "./menu.css";

const MenuContext = createContext<((viaKeyboard: boolean) => void) | null>(null);

export function Menu({
  label,
  trigger,
  side = "bottom",
  align = "start",
  className,
  children,
}: {
  /** Trigger's accessible name ("Session actions"). */
  label: string;
  /** Defaults to the "⋯" button. */
  trigger?: ReactNode;
  side?: Side;
  align?: Align;
  className?: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const point = useAnchoredPoint({ anchor, surface, open, side, align });
  const close = useCallback(
    (viaKeyboard: boolean) => {
      setOpen(false);
      if (viaKeyboard) anchor?.focus();
    },
    [anchor],
  );
  useDismiss(open, close, anchor, surface);
  // On open, focus enters the menu so arrows work right away.
  useEffect(() => {
    if (!open) return;
    // rAF: when opened with Enter, Chrome refocuses the trigger after this effect, so the menu
    // opened without focus and arrows did nothing (audit P2).
    const id = requestAnimationFrame(() =>
      surface?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, [open, surface]);

  const onSurfaceKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      close(true);
      return;
    }
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    ];
    if (moveFocus(items, items.indexOf(document.activeElement as HTMLElement), e.key))
      e.preventDefault();
  };
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={["ui-menu-trigger", className].filter(Boolean).join(" ")}
        data-icon={trigger == null ? "true" : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger ?? <MoreHorizontal size={15} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={setSurface}
            role="menu"
            aria-label={label}
            className="ui-menu"
            data-floating="true"
            data-placed={point ? "true" : undefined}
            /* `--surface-max-w` (floating.ts) bounds the window worst case; `menu.css` combines it
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
            onKeyDown={onSurfaceKey}
          >
            <MenuContext value={close}>{children}</MenuContext>
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  icon,
  shortcut,
  danger = false,
  disabled = false,
  confirmLabel,
  onSelect,
  className,
  children,
}: {
  icon?: ReactNode;
  /** Shown on the right ("⌘⏎"); listening for the shortcut stays with the caller. */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Two steps in place, like `ConfirmAction`: a modal or a second floating surface would stack
   *  two focus traps. First click: the label becomes `confirmLabel`, the menu stays open. Second
   *  click: `onSelect` runs and the menu closes. Leaving the row (Tab, click elsewhere) disarms. */
  confirmLabel?: string;
  onSelect?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const close = use(MenuContext);
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      className={["ui-menu-item", className].filter(Boolean).join(" ")}
      data-danger={danger ? "true" : undefined}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (confirmLabel && !armed) {
          setArmed(true);
          return;
        }
        onSelect?.();
        close?.(true);
      }}
    >
      {icon}
      <span className="ui-menu-item-text">{armed ? confirmLabel : children}</span>
      {shortcut && <span className="ui-menu-shortcut">{shortcut}</span>}
    </button>
  );
}

/** Separates two families of actions (act on the session ↔ destroy it). */
export function MenuSeparator() {
  return <div role="separator" className="ui-menu-sep" />;
}
