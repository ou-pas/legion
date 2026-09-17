// The situation report: the first turn of the conversation, not a banner above it.
//
// That is the structural choice of `docs/directions/direction-concierge.html`, and it settles three
// things at once: the page is never empty, the interface stays a conversation, and history has a
// natural place to live.
//
// Pure presentation, like this whole folder: it neither queries the API nor navigates. The task
// link is a slot (`renderTaskLink`): the screen knows the router, and above all the link is built
// from the id the server verified, never from an address returned by the agent (which still has no
// tool).
//
// Three states, all here: the computed report, the failure that keeps the last known report, and
// the very first launch, the only one with nothing to report, where we say why.
import { useState, type ReactElement, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { BriefItem, BriefSeverity, ConciergeBrief as Brief } from "../api/concierge.js";
import { FormError } from "../ui/form.js";
import { Markdownish } from "../ui/markdownish.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { CONCIERGE_TEXT } from "./text.js";
import "./concierge-brief.css";

/** Reading order, independent of the model's mood: what needs a decision now is on top. The sort
 *  does all the work; without it we would have rebuilt the inbox in another font. */
const RANK: Record<BriefSeverity, number> = { now: 0, soon: 1, fyi: 2 };

/** Age is computed at display, not at mount: a report ages before your eyes, and that is this
 *  slice's accepted debt (no global event stream, so a visible timestamp rather than assumed
 *  freshness). */
function minutesSince(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / 60_000));
}

export function ConciergeBrief({
  brief,
  now,
  refreshing = false,
  onRefresh,
  renderTaskLink,
  action,
}: {
  brief: Brief;
  /** Injectable for stories: "6 min ago" must not depend on the current time. */
  now?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** `(taskId, projectId, label) => <Link …>`: the screen provides its navigation element.
   *  `projectId` comes from `BriefItem.projectId`, `null` only when `taskId` is too, but the screen
   *  tolerates an unknown project (plain text, never a dead link). */
  renderTaskLink?: (taskId: string, projectId: string | null, label: ReactNode) => ReactElement;
  /** The gesture offered on the very first launch (create a project). */
  action?: ReactNode;
}) {
  // Frozen at mount: `Date.now()` during render is impure (oxlint react/purity), and the age does
  // not need the second; it refreshes when the report is redone, exactly when it changes meaningfully.
  const [mounted] = useState(() => Date.now());
  const t = CONCIERGE_TEXT.brief;
  const items = [...brief.items].sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  if (brief.reason === "nothing-to-tell") {
    return (
      <div className="cc-brief-first">
        <Text as="div" size="lg" weight="semi">
          {t.first.title}
        </Text>
        <Text as="p" tone="muted">
          {t.first.body}
        </Text>
        {action}
        <Text as="p" tone="subtle" size="sm">
          {t.first.after}
        </Text>
      </div>
    );
  }

  return (
    <div className="cc-brief">
      <div className="cc-brief-stamp">
        <Text size="2xs" tone="subtle" as="span">
          {t.age(minutesSince(brief.generatedAt, now ?? mounted))}
          {t.scope(brief.projectCount)}
        </Text>
        {onRefresh && (
          // A button, never a timer: the only way to spend a model call is to ask for it (see
          // server/src/concierge/concierge-brief.ts).
          <button
            type="button"
            className="cc-brief-refresh"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={11} aria-hidden="true" />
            {refreshing ? t.refreshing : t.refresh}
          </button>
        )}
      </div>

      <Stack gap={6} className="cc-brief-prose">
        {brief.prose.map((p, i) => (
          <Markdownish key={i} text={p} />
        ))}
      </Stack>

      {items.length > 0 && (
        <ul className="cc-brief-items">
          {items.map((item, i) => (
            <BriefRow key={i} item={item} renderTaskLink={renderTaskLink} />
          ))}
        </ul>
      )}

      {/* A refusal does not replace the previous report, it goes under it: a ten-minute-old value
          beats a blank, provided it says it is old. */}
      {brief.error !== null && (
        <FormError>
          {t.failed} — {brief.error}
        </FormError>
      )}
    </div>
  );
}

/** A triage row: level, sentence, and the link to what to decide on. The decision and its object
 *  are not two screens apart. */
function BriefRow({
  item,
  renderTaskLink,
}: {
  item: BriefItem;
  renderTaskLink?: (taskId: string, projectId: string | null, label: ReactNode) => ReactElement;
}) {
  const t = CONCIERGE_TEXT.brief;
  return (
    <li className="cc-brief-item" data-severity={item.severity}>
      <span className="cc-brief-sev">{t.severity[item.severity]}</span>
      <span className="cc-brief-text">
        <Markdownish text={item.text} />
      </span>
      {item.taskId !== null && renderTaskLink && (
        <span className="cc-brief-go">{renderTaskLink(item.taskId, item.projectId, t.open)}</span>
      )}
    </li>
  );
}
