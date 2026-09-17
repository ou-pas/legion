// A session's timeline. A tool call folds into one line and unfolds to its payload. Security
// (fs_denied) and failure (run_error) events carry hatching, the only place in the app.
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BellRing,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  CircleX,
  CloudUpload,
  FileText,
  Gauge,
  GitBranch,
  Hourglass,
  Inbox,
  ListChecks,
  MessageSquare,
  Puzzle,
  RefreshCw,
  Rocket,
  ShieldX,
  Terminal,
  TriangleAlert,
  MessageSquareReply,
  StickyNote,
  CloudAlert,
  Megaphone,
  CornerDownRight,
} from "lucide-react";
import type { ReactNode } from "react";
import "./timeline.css";

/** Production vocabulary: the runner's event names, untranslated. */
export type TimelineKind =
  | "init"
  | "status"
  | "tool_start"
  | "tool_end"
  | "text"
  | "result"
  | "repo_ready"
  | "repo_push"
  | "fs_op"
  | "fs_denied"
  | "throttle"
  | "task_status"
  | "run_error"
  | "inbox_ask"
  | "capabilities"
  | "activity"
  | "run_warning"
  | "inbox_answer"
  | "inbox_note"
  | "repo_push_failed"
  // Steering (v23): `steer` = the human spoke while running; `steer_delivered` = the runtime took it.
  // Two kinds, because the gap between them is the information: a `steer` without delivery never
  // reached the agent.
  | "steer"
  | "steer_delivered"
  // wait_for_task (v26): `dependency_wait` = the session sleeps on another task (same pause as
  // `waiting`, one more trigger); `dependency_resolved` = lifted (the target is done or deleted). The
  // wake-up that follows is an `inbox_answer` with `answeredBy: "system"`.
  | "dependency_wait"
  | "dependency_resolved"
  // Inertia pause (10/09): the session used up its turn budget while making progress and restarts
  // on its own in a fresh container. No question asked, so a resume icon, not an alert
  // (`run_warning` already has one).
  | "turn_relaunch";

export type TimelineEmphasis = "security" | "error";

const ICON: Record<TimelineKind, LucideIcon> = {
  init: Rocket,
  status: Activity,
  tool_start: Terminal,
  tool_end: CheckCheck,
  text: MessageSquare,
  result: CircleCheck,
  repo_ready: GitBranch,
  repo_push: CloudUpload,
  fs_op: FileText,
  fs_denied: ShieldX,
  throttle: Gauge,
  task_status: ListChecks,
  run_error: CircleX,
  inbox_ask: Inbox,
  capabilities: Puzzle,
  activity: Activity,
  run_warning: TriangleAlert,
  inbox_answer: MessageSquareReply,
  inbox_note: StickyNote,
  repo_push_failed: CloudAlert,
  steer: Megaphone,
  steer_delivered: CornerDownRight,
  dependency_wait: Hourglass,
  dependency_resolved: BellRing,
  turn_relaunch: RefreshCw,
};

/** Two kinds emphasise themselves: no need to say it on every call. */
const AUTO: Partial<Record<TimelineKind, TimelineEmphasis>> = {
  fs_denied: "security",
  run_error: "error",
  repo_push_failed: "error",
};

export function Timeline({
  label,
  live = false,
  className,
  children,
}: {
  /** `true` when fed live (SSE): the list becomes a live region. */
  live?: boolean;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // aria-live: events arrive over SSE without user action. Without a live region, a session going
    // running → waiting → error was announced nowhere (WCAG 4.1.3, a11y audit P1). `polite`: reading
    // is not interrupted.
    <ol
      className={["ui-timeline", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-live={live ? "polite" : undefined}
      aria-relevant="additions"
    >
      {children}
    </ol>
  );
}

export function TimelineItem({
  time,
  dateTime,
  kind,
  summary,
  emphasis,
  defaultOpen = false,
  className,
  children,
}: {
  /** Displayed time, mono ("14:32:07"). */
  time: string;
  /** Machine timestamp for `<time datetime>`. */
  dateTime?: string;
  kind: TimelineKind;
  /** Folded line: what you read skimming the trace. */
  summary: ReactNode;
  emphasis?: TimelineEmphasis;
  defaultOpen?: boolean;
  className?: string;
  /** The detail. Its presence alone makes the event foldable. */
  children?: ReactNode;
}) {
  const Icon = ICON[kind];
  const head = (
    <>
      <span className="ui-tl-kind">{kind}</span>
      <span className="ui-tl-summary">{summary}</span>
    </>
  );
  return (
    <li
      className={["ui-tl-item", className].filter(Boolean).join(" ")}
      data-kind={kind}
      data-emphasis={emphasis ?? AUTO[kind]}
    >
      <time className="ui-tl-time" dateTime={dateTime}>
        {time}
      </time>
      <Icon className="ui-tl-icon" size={14} aria-hidden="true" />
      {children == null ? (
        <div className="ui-tl-body ui-tl-line">{head}</div>
      ) : (
        // Native <details>: keyboard and mouse folding without React state or ARIA to maintain.
        <details className="ui-tl-body ui-tl-fold" open={defaultOpen}>
          <summary className="ui-tl-fold-head">
            {head}
            <ChevronRight className="ui-tl-caret" size={14} aria-hidden="true" />
          </summary>
          <div className="ui-tl-detail">{children}</div>
        </details>
      )}
    </li>
  );
}
