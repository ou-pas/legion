// The app's single modal. The legacy contract (title / onClose / footer / width) is kept as is, plus
// focus trap, focus restored to the trigger, and sub-components.
import { useId, useRef, type ReactNode } from "react";
import { DialogBody, DialogFoot, DialogHead, DialogProvider, useDialogA11y } from "./dialog.js";
import "./modal.css";

export {
  DialogHead as ModalHeader,
  DialogBody as ModalBody,
  DialogFoot as ModalFooter,
} from "./dialog.js";

/** sm = confirmation · md = short form · lg = dense form · xl = preview. */
export type ModalSize = "sm" | "md" | "lg" | "xl";

export function Modal({
  title,
  onClose,
  footer,
  size = "md",
  width,
  label,
  className,
  children,
}: {
  /** Simple title: the modal wires header, body and footer itself. Absent = composed mode (the
   *  caller provides `<ModalHeader>` / `<ModalBody>` / `<ModalFooter>`). */
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: ModalSize;
  /** Exact width in px, kept for existing modals; prefer `size`. */
  width?: number;
  /** Accessible name when there is no header (composed mode without `<ModalHeader>`). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onClose);
  return (
    <DialogProvider value={{ titleId, onClose }}>
      {/* onMouseDown, not onClick, on the scrim: a text selection ending outside the panel does not close. */}
      <div className="ui-scrim ui-modal-scrim" onMouseDown={onClose}>
        <div
          ref={panelRef}
          className={["ui-dialog-panel", "ui-modal", className].filter(Boolean).join(" ")}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-labelledby={label ? undefined : titleId}
          tabIndex={-1}
          data-size={size}
          /* Dynamic legacy width, hence the local style (this module is exempted in .oxlintrc.json). */
          style={width == null ? undefined : { width: `min(${width}px, 94vw)` }}
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
