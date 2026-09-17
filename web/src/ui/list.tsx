import type { ElementType, ReactNode } from "react";
import "./list.css";

export type ListDensity = "comfortable" | "compact";
/** `a`/`button` when the row leads somewhere or acts. */
export type ListItemTag = "div" | "li" | "a" | "button";
/** Vertical anchoring of dot, meta and actions. `center` for a row that fits its title and
 *  subtitle; `start` pins them to the first line for a row whose body runs below. Centered, the
 *  right-hand markers floated in the middle of a block they do not belong to (the repositories
 *  card's webhook dot). */
export type ListItemAlign = "center" | "start";

interface RowBase {
  /** Icon, status dot or thumbnail on the left. Never shrinks. */
  leading?: ReactNode;
  /** Right-hand block (cost, timestamp, chips): aligned, never shrunk. */
  meta?: ReactNode;
  /** Row buttons, after the meta. */
  actions?: ReactNode;
  /** Hover and cursor. Inferred from `as` when the row is a link or a button. */
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  as?: ListItemTag;
  align?: ListItemAlign;
  href?: string;
  onClick?: () => void;
  className?: string;
  id?: string;
  /** Native `title` attribute, named `tooltip` so it does not clash with a ListItem's displayed title. */
  tooltip?: string;
}

/** State goes through `data-*`, not classes. */
function shell(p: RowBase, base: string) {
  return {
    className: [base, p.className].filter(Boolean).join(" "),
    id: p.id,
    title: p.tooltip,
    "data-interactive": (p.interactive ?? (p.as === "a" || p.as === "button")) ? "true" : undefined,
    "data-align": p.align === "start" ? "start" : undefined,
    "data-selected": p.selected ? "true" : undefined,
    "data-disabled": p.disabled ? "true" : undefined,
    href: p.as === "a" && !p.disabled ? p.href : undefined,
    type: p.as === "button" ? ("button" as const) : undefined,
    disabled: p.as === "button" ? p.disabled : undefined,
    onClick: p.disabled ? undefined : p.onClick,
    "aria-current": p.selected ? ("true" as const) : undefined,
    "aria-disabled": p.disabled && p.as !== "button" ? ("true" as const) : undefined,
  };
}

/** The container carries inner lines, no line on the last row, and density. */
export function List({
  density = "comfortable",
  as: Tag = "div",
  label,
  className,
  children,
}: {
  density?: ListDensity;
  as?: "div" | "ul" | "ol";
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={["ui-list", className].filter(Boolean).join(" ")}
      data-density={density}
      role={Tag === "div" && label != null ? "list" : undefined}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}

/** Rich row: dot, truncating title, subtitle, right-aligned meta, actions. */
export function ListItem({
  title,
  sub,
  children,
  ...p
}: RowBase & {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  // `ElementType` is the accepted polymorphism escape hatch: TS cannot type the prop union of
  // `div | li | a | button` without unreadable generics for callers.
  const Tag: ElementType = p.as ?? "div";
  return (
    <Tag {...shell(p, "ui-list-item")}>
      {p.leading != null && <span className="ui-list-lead">{p.leading}</span>}
      <span className="ui-list-main">
        {/* Native `title`: once truncated, the title stays readable on hover (see Ellipsis). */}
        <span className="ui-list-title" title={typeof title === "string" ? title : undefined}>
          {title}
        </span>
        {sub != null && <span className="ui-list-sub">{sub}</span>}
        {/* The body has its own gap: the 2px between title and subtitle glue a field or block to
            the URL above it. */}
        {children != null && <span className="ui-list-body">{children}</span>}
      </span>
      {p.meta != null && <span className="ui-list-meta">{p.meta}</span>}
      {p.actions != null && <span className="ui-list-actions">{p.actions}</span>}
    </Tag>
  );
}

/** Single-line compact variant: a repo, a rule, an MCP server. */
export function ListRow({ children, ...p }: RowBase & { children: ReactNode }) {
  const Tag: ElementType = p.as ?? "div";
  return (
    <Tag {...shell(p, "ui-list-row")}>
      {p.leading != null && <span className="ui-list-lead">{p.leading}</span>}
      <span className="ui-list-main">{children}</span>
      {p.meta != null && <span className="ui-list-meta">{p.meta}</span>}
      {p.actions != null && <span className="ui-list-actions">{p.actions}</span>}
    </Tag>
  );
}
