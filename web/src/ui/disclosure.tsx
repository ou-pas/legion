// For a rare setting or a read-only list hidden by default (`TimelineItem` folds event payloads
// on its own). Native `<details>`: keyboard and mouse opening with no React state or ARIA to
// maintain.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./disclosure.css";

export function Disclosure({
  summary,
  defaultOpen = false,
  open,
  onOpenChange,
  flush = false,
  className,
  children,
}: {
  /** What reads when collapsed: a label, possibly followed by a counter `Badge`. */
  summary: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode, when another element drives opening (the pre-review file tree expands the
   *  clicked file). Without `open`, the disclosure manages itself. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Expanded content aligns with the component's edge, not under the label, for dense columns
   *  where indentation costs more than it guides (operator request, 23/08). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={["ui-disclosure", className].filter(Boolean).join(" ")}
      {...(open === undefined ? { open: defaultOpen } : { open })}
      onToggle={(e) => onOpenChange?.(e.currentTarget.open)}
      data-flush={flush ? "true" : undefined}
    >
      <summary className="ui-disclosure-head">
        <span className="ui-disclosure-summary">{summary}</span>
        <ChevronRight className="ui-disclosure-caret" size={13} aria-hidden="true" />
      </summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  );
}
