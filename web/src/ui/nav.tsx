// Does not know the router: `render` receives the computed class and content, and the page
// provides its own navigation element (TanStack's <Link>), like Link.
import { useId, type ReactElement, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./nav.css";

/** root = top-level entry · sub = a project's sub-page (indented under a 1px line). */
export type NavLevel = "root" | "sub";

interface NavRender {
  (props: { className: string; children: ReactNode; "aria-current"?: "page" }): ReactElement;
}

export function NavItem({
  icon,
  count,
  badge,
  active = false,
  level = "root",
  render,
  onClick,
  className,
  children,
}: {
  icon?: ReactNode;
  /** Right-hand count (questions waiting in the inbox, PRs to review). */
  count?: number;
  /** Free marker right of the label ("demo" chip, status dot). */
  badge?: ReactNode;
  active?: boolean;
  level?: NavLevel;
  /** E.g. `render={(p) => <Link to="/wiki" {...p} />}`. Without it, the element is a button. */
  render?: NavRender;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  // State goes through the class, not a data-*: it must survive the trip to a foreign component
  // (<Link>) that may not accept arbitrary attributes.
  const cls = [
    "ui-nav-item",
    level === "sub" && "ui-nav-item-sub",
    active && "is-active",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      {icon}
      <span className="ui-nav-text">{children}</span>
      {badge}
      {count != null && <span className="ui-nav-count">{count}</span>}
    </>
  );
  const current = active ? ("page" as const) : undefined;
  if (render) return render({ className: cls, children: body, "aria-current": current });
  return (
    <button type="button" className={cls} aria-current={current} onClick={onClick}>
      {body}
    </button>
  );
}

/** Collapsible group (a project and its sub-pages). Controlled: the app syncs `open` with the URL. */
export function NavGroup({
  icon,
  label,
  badge,
  count,
  open,
  onOpenChange,
  active = false,
  className,
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The group itself is the current page (you are in this project). */
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <div className={["ui-nav-group", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className={["ui-nav-item", active && "is-active"].filter(Boolean).join(" ")}
        onClick={() => onOpenChange(!open)}
      >
        {icon}
        <span className="ui-nav-text">{label}</span>
        {badge}
        {count != null && <span className="ui-nav-count">{count}</span>}
        <ChevronRight size={13} className="ui-nav-chevron" aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className="ui-nav-sub">
        {children}
      </div>
    </div>
  );
}

/** Rail section heading. */
export function NavLabel({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={["ui-nav-section-label", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
