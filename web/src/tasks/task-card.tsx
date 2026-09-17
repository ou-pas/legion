// A board card. In order: what marks it (gate, blocker, goal origin), what it asks, who carries it
// and where it stands, then how it was calibrated (priority → queue order, complexity → model).
// Markers are drawn icons: a glyph glued to the title is not an icon, it is text read aloud.
import type { ReactNode } from "react";
import { Link as RouterLink, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Hourglass,
  ImageOff,
  Loader,
  Link2Off,
  Minus,
  PenOff,
  Stamp,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { type Session } from "../api/sessions.js";
import { type TaskSummary } from "../api/tasks.js";
import { CHAIN_TEXT } from "../chains/text.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Chip, StatusChip } from "../ui/chip.js";
import { SESSION_CHIP } from "../sessions/session-status.js";
import { TASK_CARD_TEXT } from "./text/card.js";
import { TASK_TEXT } from "./text/vocabulary.js";
import { SESSION_TEXT } from "../sessions/text.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { Tooltip } from "../ui/tooltip.js";
import { TaskStateBadge } from "./task-state-badge.js";
import { deriveTaskState } from "./derive-task-state.js";
import "./task-card.css";
import { TASK_STATUS } from "../api/tasks.js";

/** Tasks born from a goal carry a "🎯" at the start of their name: the emoji leaves the label.
 *  Exported for `SortableTaskCard`: the drag handle's accessible name must read the same title. */
export const GOAL_MARK = /^🎯\s*/u;

const PRIORITY_ICON: Record<TaskSummary["priority"], LucideIcon> = {
  high: ArrowUp,
  med: Minus,
  low: ArrowDown,
};

/** The chip of a missing image, separate because it has two states and its own spoken label. MUTE
 *  like its neighbours: the card is a link and the rebuild gesture lives on the task page, since a
 *  privileged action inside a navigation link is reachable by a stray click. */
function ImageWaitChip({ wait }: { wait: NonNullable<TaskSummary["imageWait"]> }) {
  const label = wait.rebuilding ? TASK_CARD_TEXT.imageRebuilding : TASK_CARD_TEXT.imageAbsent;
  return (
    <Tooltip label={TASK_CARD_TEXT.imageWaitSpoken(label, wait.image, wait.runnerName)}>
      <StatusChip state="wait" size="sm">
        {wait.rebuilding ? (
          <Loader size={11} className="dm-task-image-spin" aria-hidden="true" />
        ) : (
          <ImageOff size={11} aria-hidden="true" />
        )}
        {label}
      </StatusChip>
    </Tooltip>
  );
}

/** A card's chips: what the task IS (agent, queue, blocker, time, step) and what its session DOES.
 *  One row, in reading order, with the page's gestures pushed to the right. */
function CardChips({
  task,
  session,
  agentName,
  waiting,
  actions,
}: {
  task: TaskSummary;
  session?: Session;
  agentName?: string;
  /** Waiting on another task REPLACES the session chip, which would say "waiting for you" while
   *  nobody has anything to do. */
  waiting: TaskSummary["waitingFor"];
  actions?: ReactNode;
}) {
  const blocked = task.blockedBy.length > 0;
  const blockerNames = task.blockedBy.map((b) => b.name);
  // The `todo` column mixes FOUR very different situations: queued (starts when a slot frees),
  // blocked by a predecessor, scheduled for a time, or simply committed with no deadline. Only the
  // first was marked, so you could not tell what would move on its own.
  const scheduled = task.status === TASK_STATUS.todo && task.scheduledAt !== null;
  return (
    <Row gap={6} wrap>
      {agentName && <Chip size="sm">{agentName}</Chip>}
      <QueueOrWaitChip task={task} />
      {blocked && (
        <Tooltip label={TASK_CARD_TEXT.blockedBy(blockerNames)}>
          <StatusChip state="idle" size="sm">
            {TASK_CARD_TEXT.blocked(task.blockedBy.length)}
          </StatusChip>
        </Tooltip>
      )}
      {scheduled && (
        <StatusChip state="wait" size="sm">
          <CalendarClock size={11} aria-hidden="true" />
          {TASK_CARD_TEXT.scheduled}
        </StatusChip>
      )}
      {task.stepIndex !== null && (
        <Chip size="sm" mono>
          {TASK_CARD_TEXT.step(task.stepIndex + 1)}
        </Chip>
      )}
      {task.templateRunId !== null && (
        <ChainLink runId={task.templateRunId} projectId={task.projectId} />
      )}
      {/* The wait mark REPLACES the generic session chip: "waiting for you" (SESSION_TEXT.status)
            would lie here, nobody has anything to do. */}
      {session && waiting && (
        <StatusChip state="wait" size="sm">
          <Hourglass size={11} aria-hidden="true" />
          {TASK_CARD_TEXT.waitingFor(waiting.waitForTaskName)}
        </StatusChip>
      )}
      {session && !waiting && (
        <Chip size="sm" kind={SESSION_CHIP[session.status]} dot>
          {SESSION_TEXT.status[session.status]}
        </Chip>
      )}
      {actions != null && (
        <>
          <Spacer />
          {actions}
        </>
      )}
    </Row>
  );
}

export function TaskCard({
  task,
  session,
  agentName,
  actions,
}: {
  task: TaskSummary;
  /** The task's last session, if any: carries the execution state. */
  session?: Session;
  agentName?: string;
  /** Card actions (archive), given by the page and pushed right of the chips. */
  actions?: ReactNode;
}) {
  // Blocked means at least one link, whatever the card status: a task in review can wait for the
  // remainder it proposed (breakdown spec, behaviour 10), and the board must say so. The chip COUNTS,
  // the tooltip and screen reader NAME.
  const blocked = task.blockedBy.length > 0;
  const blockerNames = task.blockedBy.map((b) => b.name);
  // v26: a session sleeping on `wait_for_task` stays `SESSION_STATUS.waiting`, the same pause as a
  // real question. Without its own mark the card read "running, waiting for you" while nobody had
  // anything to do: it wakes up on its own.
  const waiting = task.waitingFor;
  // The arrow only renders off the default (normal priority), otherwise it would be on every card and
  // tell nothing apart. `TASK_TEXT.priority[…]` is its only name, spoken through `aria-label` (D1,
  // 15/09).
  const showPriority = task.priority !== "med";
  const Priority = PRIORITY_ICON[task.priority];
  return (
    <Link
      variant="inherit"
      render={(p) => (
        <RouterLink
          to="/p/$projectId/tasks/$taskId"
          params={{ projectId: task.projectId, taskId: task.id }}
          {...p}
        />
      )}
    >
      <Card className="dm-task-card-positioned">
        <Stack gap={6}>
          <Row gap={6} align="flex-start" className="dm-task-title-row">
            {task.approvalGate && <Stamp size={13} role="img" aria-label={TASK_CARD_TEXT.gate} />}
            {task.readOnly && <PenOff size={13} role="img" aria-label={TASK_CARD_TEXT.readOnly} />}
            {blocked && (
              <Link2Off size={13} role="img" aria-label={TASK_CARD_TEXT.blockedBy(blockerNames)} />
            )}
            {task.goalId !== null && (
              <Target size={13} role="img" aria-label={TASK_CARD_TEXT.fromGoal} />
            )}
            {showPriority && (
              <Priority size={13} role="img" aria-label={TASK_TEXT.priority[task.priority]} />
            )}
            <Ellipsis lines={2} as="div" className="dm-task-title">
              {task.name.replace(GOAL_MARK, "")}
            </Ellipsis>
          </Row>

          <CardChips
            task={task}
            session={session}
            agentName={agentName}
            waiting={waiting}
            actions={actions}
          />

          {/* Derived state badge: the actual observation (sessions) next to the intention (board
              column), so contradictions show. Absolutely positioned in the top-right corner. */}
          {session &&
            (() => {
              const { state, fact } = deriveTaskState(task, session);
              return <TaskStateBadge state={state} fact={fact} />;
            })()}
        </Stack>
      </Card>
    </Link>
  );
}

/** What the card says INSTEAD OF "queued" (12/09), and the only place deciding it. Two distinct
 *  failures have the same consequence for the board reader: the queue SKIPS this task and nobody will
 *  take it, so "queued" would promise a slot that does not free itself, unlike full capacity.
 *
 *  The order is not arbitrary: an unavailable machine comes BEFORE a missing image, because no
 *  rebuild starts on a machine whose daemon does not answer; offering a rebuild there would offer a
 *  gesture bound to fail.
 *
 *  Split out to keep `CardChips` under the complexity cap (oxlint, max 15), like `ChainLink` below. */
function QueueOrWaitChip({ task }: { task: TaskSummary }) {
  if (task.runnerWait) {
    const label = TASK_CARD_TEXT.runnerWait[task.runnerWait.reason]?.(task.runnerWait.runnerName);
    return (
      <StatusChip state="bad" size="sm" title={task.runnerWait.message}>
        {label ?? task.runnerWait.message}
      </StatusChip>
    );
  }
  if (task.imageWait) return <ImageWaitChip wait={task.imageWait} />;
  if (!task.queued) return null;
  return (
    <StatusChip state="wait" size="sm">
      {TASK_CARD_TEXT.queued}
    </StatusChip>
  );
}

/** Opens the chain run (`chains/ChainRunPage.tsx`) from the card. The whole card links to the task:
 *  the click must be stopped here, like `ArchiveTask` (Board.tsx), or the task would open instead. */
function ChainLink({ runId, projectId }: { runId: string; projectId: string }) {
  const navigate = useNavigate();
  return (
    <Tooltip label={CHAIN_TEXT.run.openFromCard}>
      <Button
        variant="quiet"
        size="sm"
        aria-label={CHAIN_TEXT.run.openFromCard}
        leading={<Workflow size={12} />}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void navigate({ to: "/p/$projectId/chains/$runId", params: { projectId, runId } });
        }}
      />
    </Tooltip>
  );
}
