// The derived state badge. It shows what the sessions SHOW, next to what the column CLAIMS: the
// column is an intention set by hand, the state an observation. When they diverge (a task in
// "review" whose PR is merged, a task in "doing" whose session failed) the badge shows it.
//
// It lives in `tasks/` and not `ui/`: it was born in `ui/status-badge.tsx`, importing a `tasks/`
// type and hardcoding six domain labels, the very inversion batch 41 undid (see
// `sessions/session-status.ts`). CLAUDE.md's rule: one domain goes in its own folder.

import {
  AlertCircle,
  CheckCircle2,
  Pause,
  PlayCircle,
  AlertTriangle,
  Stamp,
  type LucideIcon,
} from "lucide-react";
import type { DerivedTaskState } from "./derive-task-state.js";
import { Tooltip } from "../ui/tooltip.js";
import { TASK_CARD_TEXT } from "./text/card.js";
import "./task-state-badge.css";

/** `Stamp` for `blocked`: the icon `ui/list.stories.tsx` already pairs with the session status
 *  `blocked`, and an approval gate is a stamp to apply. A pause waits for an answer, a gate waits
 *  for a DECISION: two gestures, two icons. */
const ICON_BY_STATE: Record<DerivedTaskState, LucideIcon> = {
  "not-started": AlertTriangle,
  running: PlayCircle,
  paused: Pause,
  blocked: Stamp,
  completed: CheckCircle2,
  failed: AlertCircle,
  contradiction: AlertTriangle,
};

export function TaskStateBadge({
  state,
  fact,
  title,
}: {
  state: DerivedTaskState;
  /** Short sentence for the tooltip and accessibility. */
  fact: string;
  /** Full tooltip title, defaults to `fact`. */
  title?: string;
}) {
  const Icon = ICON_BY_STATE[state];
  const label = TASK_CARD_TEXT.derived[state] ?? state;
  const tooltip = title || fact;

  return (
    <Tooltip label={tooltip}>
      <div
        className="task-state-badge"
        data-state={state}
        role="status"
        aria-label={TASK_CARD_TEXT.derivedSpoken(label, fact)}
      >
        <Icon size={12} aria-hidden="true" />
      </div>
    </Tooltip>
  );
}
