// A surface whose content is a list (a runner with its containers/networks, a review's comments).
// Unlike <Card>, a padded content block, the panel is a registry of rows.
import type { ReactNode } from "react";
import { Spacer } from "./flex.js";
import { AutoHeading } from "./heading-level.js";
import "./panel.css";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["ui-panel", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Object name, its state chips, its actions on the right. */
export function PanelHeader({
  icon,
  title,
  actions,
  level,
  className,
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  /** Forces the title tag. By default the level comes from depth. */
  level?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={["ui-panel-head", className].filter(Boolean).join(" ")}>
      {icon}
      {title != null && (
        <AutoHeading level={level} className="ui-panel-title">
          {title}
        </AutoHeading>
      )}
      {children}
      {actions != null && (
        <>
          <Spacer />
          {actions}
        </>
      )}
    </div>
  );
}

/** The line belongs to the row, never copied by the caller. */
export function PanelRow({
  icon,
  align = "center",
  className,
  children,
}: {
  icon?: ReactNode;
  align?: "center" | "baseline" | "start";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["ui-panel-row", className].filter(Boolean).join(" ")} data-align={align}>
      {icon}
      {children}
    </div>
  );
}

/** A note between registry rows (missing image, partial cleanup, zombie sessions). */
export function PanelNote({
  tone = "neutral",
  icon,
  className,
  children,
}: {
  tone?: "neutral" | "wait" | "bad";
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["ui-panel-note", className].filter(Boolean).join(" ")} data-tone={tone}>
      {icon}
      <span className="ui-panel-note-body">{children}</span>
    </div>
  );
}
