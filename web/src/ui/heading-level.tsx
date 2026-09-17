// Heading level derived from depth, not hardcoded.
//
// h1…h6 are not sizes: they form the document outline a screen reader offers as a heading list.
// `CardHeader` and `PanelHeader` all emitted `h3` wherever they sat, so a card directly in a page
// gave "H1 Board" then "H3 Inbox": a missing level (measured on 8 routes, a11y audit).
//
// The visual level stays independent: the class (`ui-card-title`…) carries the size, context only
// picks the tag.
import { createContext, useContext, type ReactNode } from "react";

/** Level for the next heading at this point of the tree. 2 by default: `h1` belongs to the page
 *  header. */
const HeadingLevelContext = createContext(2);

export function useHeadingLevel(): number {
  return useContext(HeadingLevelContext);
}

/** Goes one level down: any heading rendered inside is a sub-heading. `level` sets an absolute
 *  value (page root, modal content). Capped at 6, HTML has no deeper level. */
export function HeadingScope({ level, children }: { level?: number; children: ReactNode }) {
  const parent = useHeadingLevel();
  return (
    <HeadingLevelContext value={Math.min(6, Math.max(1, level ?? parent + 1))}>
      {children}
    </HeadingLevelContext>
  );
}

/** Tag from context, size from `className`. `level` is the escape hatch when depth describes the
 *  case wrongly. */
export function AutoHeading({
  level,
  className,
  id,
  title,
  children,
}: {
  level?: number;
  className?: string;
  id?: string;
  title?: string;
  children: ReactNode;
}) {
  const auto = useHeadingLevel();
  const n = Math.min(6, Math.max(1, level ?? auto));
  const Tag = `h${n}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag id={id} title={title} className={className}>
      {children}
    </Tag>
  );
}
