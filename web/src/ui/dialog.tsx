// Shared base of Modal and Drawer: focus trap, scroll lock, Escape, focus restored to the
// trigger, and the header / scrolling body / footer shell. Internal: pages import modal.js or
// drawer.js, never this.
import { createContext, use, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { IconBtn } from "./button.js";
import { HeadingScope } from "./heading-level.js";
import { UI_TEXT } from "./vocabulary.js";
import "./dialog.css";

interface DialogCtx {
  titleId: string;
  onClose: () => void;
}
const DialogContext = createContext<DialogCtx | null>(null);
export const DialogProvider = DialogContext.Provider;

const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])," +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessibility contract of a modal surface. `data-autofocus` marks the initial focus. */
export function useDialogA11y(panelRef: RefObject<HTMLDivElement | null>, onClose: () => void) {
  // Read by reference: a page recreating its `onClose` lambda each render must not rerun the
  // effect, or focus would jump back to the first field while typing.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const targets = () =>
      [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.getClientRects().length > 0,
      );
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? targets()[0] ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A floating surface opened on top (menu, popover, marked data-floating) absorbs Escape: it
      // closes alone and the modal hosting it stays open.
      if (e.key === "Escape") {
        if (!document.querySelector("[data-floating]")) latest.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Focus trap: Tab cycles within the panel, never back into the page.
      const list = targets();
      const first = list[0],
        last = list.at(-1),
        active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus();
    };
  }, [panelRef]);
}

/** Carries the accessible title (aria-labelledby) and the close button. */
export function DialogHead({
  icon,
  actions,
  className,
  children,
}: {
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ctx = use(DialogContext);
  return (
    <div className={["ui-dialog-head", className].filter(Boolean).join(" ")}>
      {icon}
      <h2 className="ui-dialog-title" id={ctx?.titleId}>
        {children}
      </h2>
      {actions}
      <IconBtn title={UI_TEXT.close} variant="quiet" onClick={() => ctx?.onClose()}>
        <X size={15} />
      </IconBtn>
    </div>
  );
}

/** The only scrolling area (header and footer stay visible). */
export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  // The surface title is an h2, so its content starts at level 3 wherever the modal was opened
  // from.
  return (
    <div className={["ui-dialog-body", className].filter(Boolean).join(" ")}>
      <HeadingScope level={3}>{children}</HeadingScope>
    </div>
  );
}

/** Actions, left-aligned; `<Spacer />` pushes to the right. */
export function DialogFoot({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["ui-dialog-foot", className].filter(Boolean).join(" ")}>{children}</div>;
}
