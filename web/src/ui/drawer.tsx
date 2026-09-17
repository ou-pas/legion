// Right-side drawer: shows an object's detail (a session, an artifact) without leaving the page.
// Same accessibility contract as Modal (focus trap, Escape, scroll lock, focus restored); it
// slides from the edge instead of sitting in the center.
import { useId, useRef, type ReactNode } from "react";
import { DialogBody, DialogFoot, DialogHead, DialogProvider, useDialogA11y } from "./dialog.js";
import "./drawer.css";

/** sm = card · md = regular detail · lg = trace/diff side by side. */
export type DrawerSize = "sm" | "md" | "lg";

export function Drawer({
  title,
  onClose,
  footer,
  size = "md",
  label,
  className,
  children,
}: {
  /** Absent = composed mode: the caller provides `<ModalHeader>` / `<ModalBody>` / `<ModalFooter>`. */
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: DrawerSize;
  /** Accessible name when there is no header. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onClose);
  return (
    <DialogProvider value={{ titleId, onClose }}>
      <div className="ui-scrim ui-drawer-scrim" onMouseDown={onClose}>
        <div
          ref={panelRef}
          className={["ui-dialog-panel", "ui-drawer", className].filter(Boolean).join(" ")}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-labelledby={label ? undefined : titleId}
          tabIndex={-1}
          data-size={size}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {title == null ? (
            children
          ) : (
            <>
              <DialogHead>{title}</DialogHead>
              <DialogBody>{children}</DialogBody>
              {footer != null && <DialogFoot>{footer}</DialogFoot>}
            </>
          )}
        </div>
      </div>
    </DialogProvider>
  );
}
