// Full-height side column against the right edge of the content area (04/09, flat mockup): a sheet
// like the rail, a line on the left, cancelling `.ui-main`'s padding to touch the edges. Head and
// foot do not scroll, the body does.
//
// The same column had been drawn twice by hand (a task's settings/runtime panel, a wiki page's
// section list) with the same copied negative margins, a geometry bound to diverge.
//
// Knows neither data nor router: the page composes head, body and foot. Below 1100px it goes under
// the content, full width, with a top line instead of the left one.
import type { ReactNode } from "react";
import "./side-panel.css";

export function SidePanel({
  label,
  head,
  foot,
  className,
  children,
}: {
  /** Accessible name of the column ("On this page"). */
  label: string;
  /** Non-scrolling top: a title, a close button. */
  head?: ReactNode;
  /** Non-scrolling bottom: gestures, an identifier. */
  foot?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside className={["ui-sidepanel", className].filter(Boolean).join(" ")} aria-label={label}>
      {head != null && <div className="ui-sidepanel-head">{head}</div>}
      <div className="ui-sidepanel-body">{children}</div>
      {foot != null && <div className="ui-sidepanel-foot">{foot}</div>}
    </aside>
  );
}
