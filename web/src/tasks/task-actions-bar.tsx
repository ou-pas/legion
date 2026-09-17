// A task's action bar.
//
// Left, what MOVES the task forward (approve, create the PR, run, discuss, move); right, what concerns
// the PAGE (terminal, pause, stop, trace, delete, panel). The order is not decorative: pause sits left
// of stop because the gentle gesture comes first.
//
// What the bar decides on its own, and its reason to exist: WHEN a gesture is not offered. "Absent" is
// not "greyed out": the native `title` of a disabled button does not show (Chrome, Safari), so a grey
// button would never explain its refusal, while the context does. Each absence carries its reason in
// a comment. The gestures themselves live in `use-task-actions.tsx`: this bar knows no network call.
//
// Under 640px (15/09): eight states out of ten wrapped to two rows, measured in a real Chrome at
// 375px, the worst case wanting 499px of buttons for 351 available. Two decisions keep one line: text
// buttons lose their label, and secondary icons (terminal, trace, delete, panel) go behind a "…".
// `useMediaQuery(COMPACT_QUERY)` and NOT CSS alone: the collapsed menu is a different STRUCTURE (a
// `<Menu>` with `role="menuitem"`, absent from the DOM above the breakpoint), and CSS cannot skip
// rendering a node.
import type { ReactNode } from "react";
import {
  CircleCheck,
  Copy,
  GitPullRequest,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { type Session } from "../api/sessions.js";
import { type Task } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { Button, IconBtn } from "../ui/button.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { Toolbar } from "../ui/toolbar.js";
import { COMPACT_QUERY, useMediaQuery } from "../ui/use-media-query.js";
import { MoveTaskControl } from "./move-task-control.js";
import { MoveTaskMenuItems } from "./move-task-menu-items.js";
import { moveOptions } from "./task-moves.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import { type TaskActions } from "./use-task-actions.js";
import { useLaunchShortcut } from "./use-launch-shortcut.js";
import "./task-actions-bar.css";

export interface TaskActionsBarProps {
  task: Task;
  session: Session | undefined;
  /** A session runs: stop and pause exist, delete and move do not. */
  active: boolean;
  /** The number of sessions already run: the armed delete label says it, because "delete a task" and
   *  "delete 4 sessions" are not decided the same way. */
  sessionCount: number;
  /** The prerequisite the task declares and that is not done: it makes approval TWO steps. What was
   *  missing on 25/08, a screen moved to `done` while its session had filed "no server route exists".
   *  The gesture stays possible, it stops being absent-minded. */
  unmetPrereq: { name: string } | null;
  /** The number of trace events: at zero there is nothing to copy. */
  eventCount: number;
  /** A PR draft awaits reading, or pushed code awaits a PR. */
  pendingPr: boolean;
  /** "Discuss first" is offered: nothing ran, nothing blocks, it is not already an interview, and the
   *  project is not the demo one. */
  canDiscuss: boolean;
  inspectorOpen: boolean;
  actions: TaskActions;
  onToggleInspector: () => void;
  /** Open the PR VIEW: a change request is not created unread. */
  onOpenPr: () => void;
  onMoved: () => void;
  onMoveError: (e: Error) => void;
}

/** The gestures moving the task forward: approve, create the PR, discuss first, run. Under 640px each
 *  loses its label (decision 2, 15/09), as originally asked, kept against the interview's
 *  recommendation to shorten words rather than drop them.
 *
 *  The main gesture keeps its SOLID fill (decision 5), the only landmark left once words are gone.
 *  Approve and Run are the only ones ever solid, and the statuses allowing them are exclusive, so they
 *  never sit side by side. */
function MainActions({
  task,
  compact,
  inReview,
  pendingPr,
  unmetPrereq,
  canDiscuss,
  runnable,
  actions,
  onOpenPr,
}: {
  task: Task;
  compact: boolean;
  inReview: boolean;
  pendingPr: boolean;
  unmetPrereq: { name: string } | null;
  canDiscuss: boolean;
  runnable: boolean;
  actions: TaskActions;
  onOpenPr: () => void;
}) {
  return (
    <>
      {/* Approve, in ONE step usually, TWO when a prerequisite is sleeping, and ALWAYS two under 640px
          (decision 4): without a label the icon would be a bare check, and `ConfirmAction` in
          `iconOnly` mode names it on the first tap. */}
      {inReview &&
        (compact ? (
          <ConfirmAction
            variant="primary"
            iconOnly
            leading={<CircleCheck size={13} />}
            label={TASK_PAGE_TEXT.actions.approve}
            confirmLabel={
              unmetPrereq
                ? TASK_PAGE_TEXT.actions.approveBlocked(unmetPrereq.name)
                : TASK_PAGE_TEXT.actions.approve
            }
            announce={
              unmetPrereq
                ? TASK_PAGE_TEXT.actions.approveBlockedAnnounce(unmetPrereq.name)
                : undefined
            }
            onConfirm={actions.approve}
          />
        ) : unmetPrereq ? (
          <ConfirmAction
            variant="default"
            leading={<CircleCheck size={13} />}
            label={TASK_PAGE_TEXT.actions.approve}
            confirmLabel={TASK_PAGE_TEXT.actions.approveBlocked(unmetPrereq.name)}
            announce={TASK_PAGE_TEXT.actions.approveBlockedAnnounce(unmetPrereq.name)}
            onConfirm={actions.approve}
          />
        ) : (
          <Button variant="primary" leading={<CircleCheck size={13} />} onClick={actions.approve}>
            {TASK_PAGE_TEXT.actions.approve}
          </Button>
        ))}
      {/* In REVIEW only: "create the PR" is the companion of "approve"; two real review loops (23/08)
          showed one of them buried in a tab. Outside review the draft stays a FACT of the verdict
          block; here it is a DECISION, when it is made. Always hollow: the solid fill stays on
          Approve. */}
      {inReview &&
        pendingPr &&
        (compact ? (
          <IconBtn title={TASK_PAGE_TEXT.actions.createPr} onClick={onOpenPr}>
            <GitPullRequest size={13} />
          </IconBtn>
        ) : (
          <Button leading={<GitPullRequest size={13} />} onClick={onOpenPr}>
            {TASK_PAGE_TEXT.actions.createPr}
          </Button>
        ))}
      {/* RUN BEFORE DISCUSS, at both widths (decision 1, "launch first" spec, 16/09): the most
          frequent gesture on a posted task, and an order rearranging on resize would be relearned
          every time. Stays ONE tap (decision 4, 15/09): it can be undone (stop), and an extra tap
          would be paid every day. */}
      {runnable &&
        (compact ? (
          <IconBtn
            title={TASK_PAGE_TEXT.actions.run}
            variant="primary"
            loading={actions.pending.run}
            onClick={actions.run}
          >
            <Play size={12} />
          </IconBtn>
        ) : (
          <Button
            variant="primary"
            icon={<Play size={12} />}
            loading={actions.pending.run}
            onClick={actions.run}
            shortcut={<SubmitShortcut />}
          >
            {TASK_PAGE_TEXT.actions.run}
          </Button>
        ))}
      {/* DISCUSS FIRST (D2), for a posted task whose brief is too thin. Already TWO steps because the
          gesture changes the assignment: this task becomes the interview, and the interviewer will
          file the spec as a child task. Under 640px only the resting state becomes an icon. */}
      {canDiscuss && (
        <ConfirmAction
          variant="default"
          iconOnly={compact}
          disabled={actions.pending.discuss}
          leading={<MessagesSquare size={13} />}
          label={INTERVIEW_TEXT.start.takeOver}
          confirmLabel={INTERVIEW_TEXT.start.takeOverConfirm}
          announce={INTERVIEW_TEXT.start.takeOverAnnounce(task.name)}
          onConfirm={actions.discuss}
        />
      )}
    </>
  );
}

/** The collapsed "…" menu under 640px, in three groups (decisions 2 and 3, "launch first" spec,
 *  16/09): resume + move, then trace + panel, then delete alone, as the operator dictated in round 2.
 *  An empty group draws no separator: every row is already conditional, and "no session, no possible
 *  destination" (active task) is reachable; it must not open the menu on a lone rule.
 *
 *  Split from `EndActions` to stay under `oxlint(complexity)`: the two widths share little once the
 *  three groups are written. */
function CompactMoreMenu({
  task,
  session,
  active,
  sessionCount,
  eventCount,
  actions,
  onToggleInspector,
  onMoved,
  onMoveError,
  panelLabel,
  panelIcon,
}: Pick<
  TaskActionsBarProps,
  | "task"
  | "session"
  | "active"
  | "sessionCount"
  | "eventCount"
  | "onToggleInspector"
  | "actions"
  | "onMoved"
  | "onMoveError"
> & { panelLabel: string; panelIcon: ReactNode }) {
  // GROUP 1, what touches the SESSION: resume in the terminal, move. Absent while a session works
  // (same guard as delete). Destination rules stay in `task-moves.ts`; this only tells whether the
  // group has something to draw a separator for.
  const destinations = active ? [] : moveOptions(task.status);
  const group1NonEmpty = Boolean(session) || destinations.length > 0;
  // GROUP 3, the destructive gesture, alone after the second separator.
  const group3NonEmpty = !active;

  return (
    <Menu label={TASK_PAGE_TEXT.actions.more} align="end" className="task-actions-menu-trigger">
      {session && (
        <MenuItem icon={<Terminal size={14} />} onSelect={actions.copyResume}>
          {TASK_PAGE_TEXT.actions.resume}
        </MenuItem>
      )}
      {destinations.length > 0 && (
        <MoveTaskMenuItems
          taskId={task.id}
          destinations={destinations}
          onMoved={onMoved}
          onError={onMoveError}
        />
      )}
      {/* An empty group draws no separator, or "no session, no destination" would open the menu on a
          lone rule. */}
      {group1NonEmpty && <MenuSeparator />}
      {/* ABSENT when the trace is empty (decision 7, 15/09), not greyed: the server does not refuse
          copying, it is just pointless. */}
      {eventCount > 0 && (
        <MenuItem icon={<Copy size={14} />} onSelect={actions.copyTrace}>
          {TASK_PAGE_TEXT.actions.copyTrace}
        </MenuItem>
      )}
      <MenuItem icon={panelIcon} onSelect={onToggleInspector}>
        {panelLabel}
      </MenuItem>
      {group3NonEmpty && <MenuSeparator />}
      {/* Absent while a session works: the server would refuse (409). Two steps kept in place: the
          menu only closes on confirmation. */}
      {!active && (
        <MenuItem
          icon={<Trash2 size={14} />}
          danger
          confirmLabel={
            sessionCount > 0
              ? TASK_PAGE_TEXT.actions.confirmDelete(sessionCount)
              : TASK_PAGE_TEXT.actions.confirmDeleteAlone
          }
          onSelect={actions.remove}
        >
          {TASK_PAGE_TEXT.actions.delete}
        </MenuItem>
      )}
    </Menu>
  );
}

/** The gestures at the end of the bar: what is done to the SESSION (resume in the terminal, move,
 *  pause, stop, copy the trace), then to the view (the panel). Icons only since 04/09; the full label
 *  stays in the tooltip and accessible name.
 *
 *  Under 640px (decision 1, 15/09) terminal, trace, delete and panel go behind a "…", spelled out this
 *  time since a tooltip does not answer a finger. PAUSE AND STOP STAY OUT (decision 6): while a session
 *  runs the left group is empty, and folding everything would shrink the bar to a single button. */
function EndActions({
  task,
  session,
  active,
  sessionCount,
  eventCount,
  inspectorOpen,
  compact,
  actions,
  onToggleInspector,
  onMoved,
  onMoveError,
}: Pick<
  TaskActionsBarProps,
  | "task"
  | "session"
  | "active"
  | "sessionCount"
  | "eventCount"
  | "inspectorOpen"
  | "onToggleInspector"
  | "actions"
  | "onMoved"
  | "onMoveError"
> & { compact: boolean }) {
  const panelLabel = inspectorOpen ? TASK_PAGE_TEXT.inspector.close : TASK_PAGE_TEXT.inspector.open;
  const panelIcon = inspectorOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />;

  // PAUSE asks, it does not force: the agent stops at the end of its turn after pushing, and an inbox
  // entry resumes exactly there. The server refuses it during `committing`: interrupting a push is the
  // only way to lose work with this mechanism, and its sentence says so.
  const pauseStop = active && session && (
    <>
      <IconBtn title={TASK_PAGE_TEXT.actions.pause} onClick={actions.pause}>
        <Pause size={13} />
      </IconBtn>
      <IconBtn title={TASK_PAGE_TEXT.actions.stop} danger onClick={actions.stop}>
        <Square size={13} />
      </IconBtn>
    </>
  );

  if (compact) {
    return (
      <>
        {pauseStop}
        <CompactMoreMenu
          task={task}
          session={session}
          active={active}
          sessionCount={sessionCount}
          eventCount={eventCount}
          actions={actions}
          onToggleInspector={onToggleInspector}
          onMoved={onMoved}
          onMoveError={onMoveError}
          panelLabel={panelLabel}
          panelIcon={panelIcon}
        />
      </>
    );
  }

  return (
    <>
      {session && (
        <IconBtn title={TASK_PAGE_TEXT.actions.resume} onClick={actions.copyResume}>
          <Terminal size={14} />
        </IconBtn>
      )}
      {pauseStop}
      {/* ABSENT when the trace is empty (decision 7, 15/09), never greyed: the native `title` of a
          disabled button shows on neither Chrome nor Safari, so a grey button would never have said
          there was nothing to copy. */}
      {eventCount > 0 && (
        <IconBtn title={TASK_PAGE_TEXT.actions.copyTrace} onClick={actions.copyTrace}>
          <Copy size={14} />
        </IconBtn>
      )}
      {/* Absent while a session works: the server would refuse (409), and the context says so, since
          the gesture offered right next to it is "stop". */}
      {!active && (
        <ConfirmAction
          variant="danger"
          iconOnly
          leading={<Trash2 size={13} />}
          label={TASK_PAGE_TEXT.actions.delete}
          confirmLabel={
            sessionCount > 0
              ? TASK_PAGE_TEXT.actions.confirmDelete(sessionCount)
              : TASK_PAGE_TEXT.actions.confirmDeleteAlone
          }
          announce={TASK_PAGE_TEXT.actions.announceDelete(task.name)}
          onConfirm={actions.remove}
        />
      )}
      {/* The icon SAYS the state (panel open / to open) and `aria-pressed` gives it a pressed look:
          without both, nothing said it reopened anything. */}
      <IconBtn
        title={panelLabel}
        aria-pressed={inspectorOpen}
        aria-expanded={inspectorOpen}
        onClick={onToggleInspector}
      >
        {panelIcon}
      </IconBtn>
    </>
  );
}

export function TaskActionsBar({
  task,
  session,
  active,
  sessionCount,
  unmetPrereq,
  eventCount,
  pendingPr,
  canDiscuss,
  inspectorOpen,
  actions,
  onToggleInspector,
  onOpenPr,
  onMoved,
  onMoveError,
}: TaskActionsBarProps) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const inReview = task.status === TASK_STATUS.review;
  // "Later" only blocks AUTOMATIC paths: running a noted task by hand stays allowed, an explicit
  // gesture. A BLOCKED task runs neither by hand nor through the queue: no button, and the blockers
  // panel below says by whom.
  const runnable =
    task.blockedBy.length === 0 &&
    (task.status === TASK_STATUS.todo ||
      task.status === TASK_STATUS.later ||
      (!active && task.status === TASK_STATUS.doing));
  // ⌘/Ctrl+Enter does what the click does: one path, so mouse and keyboard cannot diverge (same
  // principle as the rail shortcut, ui/use-rail.ts).
  useLaunchShortcut(runnable, actions.run);

  return (
    <Toolbar
      label={TASK_PAGE_TEXT.actions.label}
      className="task-actions-bar"
      end={
        <EndActions
          task={task}
          session={session}
          active={active}
          sessionCount={sessionCount}
          eventCount={eventCount}
          inspectorOpen={inspectorOpen}
          compact={compact}
          actions={actions}
          onToggleInspector={onToggleInspector}
          onMoved={onMoved}
          onMoveError={onMoveError}
        />
      }
    >
      <MainActions
        task={task}
        compact={compact}
        inReview={inReview}
        pendingPr={pendingPr}
        unmetPrereq={unmetPrereq}
        canDiscuss={canDiscuss}
        runnable={runnable}
        actions={actions}
        onOpenPr={onOpenPr}
      />
      {/* Under 640px (decision 2, 16/09) this trigger is not mounted: its destinations become rows of
          the "…" menu, rendered by `EndActions`. Above the breakpoint it stays at the end of the left
          group. */}
      {!active && !compact && (
        <MoveTaskControl task={task} onMoved={onMoved} onError={onMoveError} />
      )}
    </Toolbar>
  );
}
