import type { CSSProperties, ReactNode } from "react";
import { Spacer } from "./flex.js";
import { AutoHeading } from "./heading-level.js";
import "./card.css";

export function CardHeader({
  icon,
  title,
  sub,
  actions,
  level,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  /** Forces the title tag. By default the level comes from depth: a card in a page is an `h2`,
   *  the same card in a section an `h3`. */
  level?: number;
  /** Detail next to the title (an agent's role, a runner's host). A `<Text size="sm">` inlined
   *  in the title read as equally important (operator feedback); a dedicated slot renders it the
   *  same everywhere. */
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["ui-card-head", className].filter(Boolean).join(" ")}>
      {icon}
      {/* Title and subtitle stack. On the same line, flex wrapping pushed the subtitle above the
          title (operator feedback). */}
      {(title != null || sub != null) && (
        <div className="ui-card-heading">
          {title != null && (
            <AutoHeading level={level} className="ui-card-title">
              {title}
            </AutoHeading>
          )}
          {sub != null && <span className="ui-card-sub">{sub}</span>}
        </div>
      )}
      {actions != null && (
        <>
          <Spacer />
          {actions}
        </>
      )}
    </div>
  );
}

/** Capped at reading measure. */
export function CardDescription({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={["ui-card-desc", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Padded body inside a `pad={false}` card (an edge-to-edge list plus a text block). */
export function CardBody({
  pad = true,
  className,
  children,
}: {
  pad?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-card-body", className].filter(Boolean).join(" ")}
      data-pad={pad ? "true" : "false"}
    >
      {children}
    </div>
  );
}

export function Card({
  icon,
  title,
  sub,
  desc,
  actions,
  level,
  pad = true,
  className,
  style,
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  level?: number;
  pad?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={["ui-card", className].filter(Boolean).join(" ")}
      data-pad={pad ? "true" : "false"}
      style={style}
    >
      {(title != null || actions != null) && (
        <CardHeader icon={icon} title={title} sub={sub} actions={actions} level={level} />
      )}
      {desc != null && <CardDescription>{desc}</CardDescription>}
      {children}
    </div>
  );
}
