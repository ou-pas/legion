// The only module allowed to style its descendants (`p`, `ul`, `li`, `code`, `strong`, `a`): content
// comes from the operator or agents, a class cannot be required on each tag.
import type { ReactNode } from "react";
import "./prose.css";

export function Prose({
  size = "md",
  tone = "default",
  width = "full",
  as: Tag = "div",
  className,
  id,
  children,
}: {
  size?: "sm" | "md";
  tone?: "default" | "muted";
  /** `full` (default) follows its container · `measure` caps at var(--measure), 72ch.
   *
   *  The default changed on 26/08 (operator decision): a card that is its page's content (an
   *  agent's job description, a task brief) stopped halfway on a wide screen, which reads as broken
   *  rendering. Where the container is already narrow `full` renders exactly like `measure`. Keep
   *  `measure` for the wiki, long text read in one go. */
  width?: "measure" | "full";
  as?: "div" | "section" | "article";
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      id={id}
      className={["ui-prose", className].filter(Boolean).join(" ")}
      data-size={size}
      data-tone={tone}
      data-width={width}
    >
      {children}
    </Tag>
  );
}
