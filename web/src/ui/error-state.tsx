// Copy rule: an error names the problem (technical message, mono, copyable) and the way out (the
// actions), never one without the other.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, CircleAlert } from "lucide-react";
import { Button } from "./button.js";
import { UI_TEXT } from "./vocabulary.js";
import "./error-state.css";

export function ErrorState({
  title,
  detail,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  /** The engine's raw message: "Timeout after 600s — heap out of memory at 512 invoices". */
  detail?: string;
  /** Ways out: run again with a diagnostic, leave in review, open the session. */
  actions?: ReactNode;
  className?: string;
  /** What it means for the operator, in plain words. One or two sentences. */
  children?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={["ui-error-state", className].filter(Boolean).join(" ")} role="alert">
      <div className="ui-error-head">
        <CircleAlert size={15} aria-hidden="true" />
        <p className="ui-error-title">{title}</p>
      </div>
      {children != null && <p className="ui-error-msg">{children}</p>}
      {detail != null && (
        <div className="ui-error-detail">
          <code className="ui-error-trace" id={`${id}-trace`} data-open={open ? "true" : undefined}>
            {detail}
          </code>
          <Button
            variant="quiet"
            aria-expanded={open}
            aria-controls={`${id}-trace`}
            trailing={open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            onClick={() => setOpen(!open)}
          >
            {open ? UI_TEXT.errorDetail.collapse : UI_TEXT.errorDetail.expand}
          </Button>
        </div>
      )}
      {actions != null && <div className="ui-error-actions">{actions}</div>}
    </div>
  );
}
