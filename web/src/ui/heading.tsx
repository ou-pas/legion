// Decouples the visual level (scale, `level`) from the semantic one (tag, `as`): a card can carry
// an `h3` that looks like a block title without breaking the outline.
import type { ReactNode } from "react";
import "./heading.css";

/** 1 = page title (--fs-3xl) · 2 = strong section · 3 = card title · 4 = dense block title. */
export type HeadingLevel = 1 | 2 | 3 | 4;
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div";

export function Heading({
  level = 2,
  as,
  className,
  id,
  focusable = false,
  children,
}: {
  level?: HeadingLevel;
  /** Defaults to `h{level}`; override to respect the outline. */
  as?: HeadingTag;
  className?: string;
  id?: string;
  /** Can receive focus programmatically (`tabIndex=-1`) without entering the tab order. For a
   *  screen that changes without changing URL (a questionnaire's next step): focusing its title
   *  announces the change to those who cannot see it (07/09). */
  focusable?: boolean;
  children: ReactNode;
}) {
  const Tag: HeadingTag = as ?? (`h${level}` as HeadingTag);
  return (
    <Tag
      id={id}
      className={["ui-heading", className].filter(Boolean).join(" ")}
      data-level={level}
      tabIndex={focusable ? -1 : undefined}
    >
      {children}
    </Tag>
  );
}
