// An empty state is a screen of its own: a drawn board, a title, and the way out. `cleared` is the
// good-news empty: nothing is waiting for you.
//
// The sentence under the title is optional, and that is a contract (D5, 15/09): it renders only
// when it carries a cause the title does not already say (a filter, a condition, a failure).
import type { ReactNode } from "react";
import "./empty.css";

/** frame = nothing created yet · cleared = everything handled · filtered = the filter returns
 *  nothing · torn = the screen stopped (14/09).
 *
 *  `torn` lives here rather than in its own component because a broken screen is an empty state:
 *  nothing to show, and the app already has a language for it. */
export type EmptyArt = "frame" | "cleared" | "filtered" | "torn";

/** Dashed frame, ruled lines, no mascot. Strokes use tokens. */
function Art({ kind }: { kind: EmptyArt }) {
  return (
    <svg
      className="ui-empty-art"
      viewBox="0 0 120 80"
      data-art={kind}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="ui-empty-frame" x="1" y="1" width="118" height="78" rx="4" />
      <g className="ui-empty-rules">
        <path d="M22 30 h76" />
        <path d="M22 44 h58" />
        <path d="M22 58 h34" />
      </g>
      {kind === "cleared" && <path className="ui-empty-check" d="M45 41 l9 10 l22 -25" />}
      {kind === "filtered" && <path className="ui-empty-strike" d="M18 67 L102 15" />}
      {/* The tear crosses the whole board: the series' only colored stroke. */}
      {kind === "torn" && (
        <path className="ui-empty-tear" d="M52 1 l6 14 l-9 10 l8 13 l-7 12 l8 15 l-6 14" />
      )}
    </svg>
  );
}

export function Empty({
  variant = "panel",
  art = "frame",
  title,
  action,
  className,
  children,
}: {
  /** page = full screen · panel = in a card or panel · inline = a list row. */
  variant?: "page" | "panel" | "inline";
  art?: EmptyArt;
  title: ReactNode;
  /** The way out: create, widen the filter, go back. Just one. */
  action?: ReactNode;
  className?: string;
  /** The cause, when the title does not carry it. Usually absent (D5). */
  children?: ReactNode;
}) {
  return (
    <div className={["ui-empty", className].filter(Boolean).join(" ")} data-variant={variant}>
      <Art kind={art} />
      <div className="ui-empty-text">
        <p className="ui-empty-title">{title}</p>
        {children != null && <p className="ui-empty-body">{children}</p>}
      </div>
      {action != null && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
