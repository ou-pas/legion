// The waiting panel: what is stopped, grouped by project (direction-double-nav mockup, the bell panel).
// A SUMMONS rather than a page: "only be interrupted when a decision is yours" holds only if one place
// says it.
//
// It lives in `inbox/`, not `ui/`: it knows questions and gates. It does not know the ROUTER: `render`
// gets computed props and the caller provides its <Link>, like `projects/project-rail.tsx`, so stories
// need no router.
import { useState, type ReactElement, type ReactNode } from "react";
import { CircleHelp, ClipboardCheck, Inbox } from "lucide-react";
import { ProjectSquare } from "../projects/project-rail.js";
import { Popover } from "../ui/popover.js";
import { INBOX_TEXT } from "./text.js";
import type { PendingEntry, PendingGroup } from "./pending-entries.js";
import "./pending-panel.css";

/** The button opening it, in the bar, living with its surface: a trigger apart from its panel means two
 *  files for one idea.
 *
 *  `count` is the CROSS total of what is stopped, summed from `/api/inbox/pending-by-project`. No
 *  second computation: two sources for one number guarantee the rail badge and the bar disagree one
 *  day.
 *
 *  At zero the button STAYS, muted: its fixed place makes the count readable at a glance. */
export function PendingButton({ count, children }: { count: number; children: ReactNode }) {
  return (
    // `openOn="hover"` (02/09): inside the status group it was the only item silent on hover (sessions
    // shows a tooltip, Docker opens the fleet card). Hover opens the panel; click still works.
    <Popover
      label={INBOX_TEXT.pending.buttonLabel(count)}
      openOn="hover"
      side="bottom"
      align="end"
      triggerClassName="pending-button"
      className="pending-pop"
      trigger={
        <>
          <Inbox className="pending-button-icon" aria-hidden="true" />
          <span className="pending-button-count">{count}</span>
          <span
            className="pending-button-indicator"
            data-on={count > 0 ? "true" : undefined}
            aria-hidden="true"
          />
          <span className="ui-sr">{INBOX_TEXT.pending.buttonLabel(count)}</span>
        </>
      }
    >
      {children}
    </Popover>
  );
}

/** Exported: the function building a row's link lives outside `Layout` (router.tsx) and needs the
 *  type. */
export interface EntryRender {
  (
    entry: PendingEntry,
    props: { className: string; children: ReactNode; "aria-label": string },
  ): ReactElement;
}

/** Compact on hover, complete on demand (02/09). Opening on hover, a rich panel appeared on a mere
 *  mouse pass (operator feedback). Hover gives the GLANCE (per-project counts, oldest decisions) and
 *  "See all" expands the grouped surface. The popover unmounts its content on close, so the next
 *  hover starts compact with no state to reset.
 *
 *  No notices here: they stop nobody and live in System › Logs (`notices-journal.tsx`). */
export function PendingPanel({
  groups,
  defaultExpanded = false,
  render,
}: {
  groups: PendingGroup[];
  /** For stories: the expanded state without simulating a click. In production it always opens
   *  compact. */
  defaultExpanded?: boolean;
  render?: EntryRender;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const stopped = groups.reduce((n, g) => n + g.entries.length, 0);
  // The oldest ACROSS PILES: what waited longest deserves the glance, not the first project.
  const oldest = groups
    .flatMap((g) => g.entries)
    .sort((a, b) => a.since - b.since)
    .slice(0, 3);

  return (
    <div className="pending-panel" data-compact={expanded ? undefined : "true"}>
      <header className="pending-panel-head">
        <b>{INBOX_TEXT.pending.title}</b>
        <span>{INBOX_TEXT.pending.subtitle(stopped)}</span>
      </header>

      {stopped === 0 && (
        <p className="pending-panel-quiet">
          <b>{INBOX_TEXT.pending.nothingStopped}</b>
        </p>
      )}

      {!expanded && stopped > 0 && (
        <>
          {groups.length > 1 && (
            <div className="pending-panel-counts">
              {groups.map((g) => (
                <span key={g.project.id} className="pending-panel-count">
                  <ProjectSquare project={g.project} size="sm" />
                  {g.project.name}
                  <b>{g.entries.length}</b>
                </span>
              ))}
            </div>
          )}
          {oldest.map((entry) => (
            <Entry key={entry.id} entry={entry} render={render} />
          ))}
          {stopped > oldest.length && (
            <button type="button" className="pending-panel-more" onClick={() => setExpanded(true)}>
              {INBOX_TEXT.pending.seeAll(stopped)}
            </button>
          )}
        </>
      )}

      {expanded &&
        groups.map((group) => (
          <section key={group.project.id}>
            {/* The project MARK, as in the icon rail: it identifies the group before its name is
              read. */}
            <h3 className="pending-panel-group">
              <ProjectSquare project={group.project} size="sm" />
              {group.project.name}
            </h3>
            {group.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} render={render} />
            ))}
          </section>
        ))}
    </div>
  );
}

/** A row. The click leads where the decision is made: the question PAGE for a round (07/09), its TASK
 *  otherwise (`entry.question`, decided by `pending-entries.ts`).
 *
 *  The gesture is WRITTEN (Resume, Answer, Approve): on a started round, Resume says in one word what
 *  the meta gauge makes you compute. */
function Entry({ entry, render }: { entry: PendingEntry; render?: EntryRender }) {
  const body = (
    <>
      <span className="pending-panel-icon" aria-hidden="true">
        {entry.kind === "gate" ? <ClipboardCheck /> : <CircleHelp />}
      </span>
      <span className="pending-panel-text">
        {entry.text}
        <em>{entry.meta}</em>
      </span>
      <span className="pending-panel-go" aria-hidden="true">
        {entry.action}
      </span>
    </>
  );
  const shared = {
    className: "pending-panel-item",
    "aria-label": INBOX_TEXT.pending.entryLabel(entry.text),
  };
  // Without `render` the row is not interactive: a report, not a fake button leading nowhere (as in
  // stories).
  if (render) return render(entry, { ...shared, children: body });
  return <div className={shared.className}>{body}</div>;
}
