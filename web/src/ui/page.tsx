// Page shell: the same content width and header everywhere.
import type { ReactNode } from "react";
import { Spacer } from "./flex.js";
import { AutoHeading, HeadingScope } from "./heading-level.js";
import "./page.css";

export function PageHeader({
  title,
  sub,
  actions,
  level,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** `<Page>` passes 1: the screen's title. On its own (a story specimen) the header takes its
   *  depth's level, so an example does not steal the page's h1. */
  level?: number;
}) {
  return (
    <header className="ui-page-head">
      {/* Title and subtitle form one group: actions must never slip in between. */}
      <div className="ui-page-heading-line">
        <AutoHeading level={level} className="ui-page-heading">
          {title}
        </AutoHeading>
        {/* div, not p: pages pass chips and <Row> in here (ProjectPage) */}
        {sub && <div className="ui-page-sub">{sub}</div>}
      </div>
      {actions && (
        <>
          <Spacer />
          {actions}
        </>
      )}
    </header>
  );
}

/** Section heading carrying the rule: here two sections are separated by a line. */
export function SectionTitle({
  title,
  count,
  actions,
  id,
  level,
}: {
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  id?: string;
  /** Forces the tag. Defaults to the level derived from depth (see heading-level). */
  level?: number;
}) {
  return (
    <div className="ui-section-title" id={id}>
      <AutoHeading level={level} className="ui-section-heading">
        {title}
      </AutoHeading>
      {count !== undefined && <span className="ui-section-count">{count}</span>}
      {actions != null && (
        <>
          <Spacer />
          {actions}
        </>
      )}
    </div>
  );
}

/** Without `children`: the heading alone (legacy usage). */
export function Section({
  title,
  count,
  actions,
  children,
}: {
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const head = <SectionTitle title={title} count={count} actions={actions} />;
  if (children === undefined) return head;
  // Section content goes one level down: its cards are sub-parts of the heading, not siblings.
  return (
    <section className="ui-section">
      {head}
      <HeadingScope>{children}</HeadingScope>
    </section>
  );
}

/** Every page has the same width (the available content width): no exception, no `wide`. */
export function Page({
  title,
  sub,
  actions,
  className,
  object = false,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** The title is an object's (a goal, an agent, a wiki page), not the screen's name, so it
   *  renders. Without this flag `title` and `sub` do not render (04/09): the top bar already names
   *  the screen and holds the h1 (`ui/shell.tsx`), and repeating it in 3xl just below taught
   *  nothing (operator feedback). The props stay accepted everywhere; only actions render. */
  object?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={["ui-page", className].filter(Boolean).join(" ")}>
      {object
        ? (title != null || actions != null) && (
            <PageHeader title={title} sub={sub} actions={actions} level={2} />
          )
        : actions != null && <div className="ui-page-actions">{actions}</div>}
      {/* The h1 is in the top bar, so everything below starts at level 2. */}
      <HeadingScope level={2}>{children}</HeadingScope>
    </div>
  );
}
