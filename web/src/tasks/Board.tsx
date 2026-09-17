// A project's kanban: five columns, the project inbox on top, the launch bar, then the tasks. Each
// column states its load (count + share of the board): a board whose "Review" holds half the tasks
// shows at a glance. Drag and drop mechanics (local order, server call, rollback) live in
// `useKanbanDnd`; this file only wires them to the column rendering.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { Archive } from "lucide-react";
import { type Session } from "../api/sessions.js";
import { tasksApi } from "../api/tasks.js";
import { bootstrapQuery, inboxQuery, infraQuery, qk, tasksQuery } from "../queries.js";
import { Banner } from "../ui/banner.js";
import { Button, ButtonGroup, IconBtn, ToggleButton } from "../ui/button.js";
import { Grid, Row, Spacer, Stack } from "../ui/flex.js";
import { Inset } from "../ui/inset.js";
import { Link } from "../ui/link.js";
import { Meter, type MeterThresholds } from "../ui/meter.js";
import { Num } from "../ui/num.js";
import { Page } from "../ui/page.js";
import { Tooltip } from "../ui/tooltip.js";
import { COMPACT_QUERY, useMediaQuery } from "../ui/use-media-query.js";
import { useToast } from "../ui/toast.js";
import { DraggedTaskCard } from "./sortable-task-card.js";
import { KanbanColumnBody } from "./kanban-column.js";
import { useKanbanDnd } from "./use-kanban-dnd.js";
import { InboxPanel } from "../inbox/InboxPanel.js";
import { useProject } from "../projects/project.js";
import { readLane, writeLane } from "./board-lane.js";
import { LauncherBar } from "./TaskComposer.js";
import { BOARD_TEXT } from "./text/board.js";
import "./board.css";
import { TASK_STATUS } from "../api/tasks.js";

// "Later" first: the board reads as a timeline, and the commitment line is visible without
// explanation, everything to its right is committed. Order lives here, words in `text/board.ts`.
const COLS = [
  TASK_STATUS.later,
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.done,
] as const;

// A column gauge states a SHARE of the board, not saturation: the Meter alarm thresholds are pushed
// out of reach, since a full column is not an alert, it is just where the work is.
const NO_ALARM: MeterThresholds = { wait: 2, bad: 2 };

export function Board() {
  // A SINGLE lane on a phone (13/09). Stacked, the five lanes make a page you scroll without ever
  // holding: what you came for (what runs, what waits) sits among thirty done cards. Operator
  // feedback on an iPhone 16.
  //
  // Rendered, not hidden, hence reading the breakpoint in JavaScript rather than CSS: a lane hidden in
  // CSS keeps its cards in the DOM, so in dnd-kit's tree and in the tab order.
  const compact = useMediaQuery(COMPACT_QUERY);
  const { project, projectId } = useProject();
  // The lane is remembered per project (14/09, operator request); rule and storage live in
  // `board-lane.ts`. Read in the initialiser rather than an effect: a first render on the wrong lane
  // followed by a correcting one is what `react(set-state-in-effect)` refuses, and what the eye sees
  // as a jolt.
  const [lane, setLane] = useState<(typeof COLS)[number]>(() => readLane(projectId));
  const pickLane = (next: (typeof COLS)[number]) => {
    setLane(next);
    writeLane(projectId, next);
  };
  const { data: boot } = useQuery(bootstrapQuery);
  const { data } = useQuery(tasksQuery);
  const { data: inbox = [] } = useQuery(inboxQuery);
  const { data: infra } = useQuery(infraQuery);
  const qc = useQueryClient();
  // Filtered by project and without archived tasks (still reachable by direct link). Memoised:
  // `useKanbanDnd` closes a `useEffect` over this reference to resync local order ONLY when data or
  // project really change; a fresh `.filter()` each render would retrigger it in a loop.
  const tasks = useMemo(
    () =>
      (data?.tasks ?? []).filter((t) => (!project || t.projectId === project.id) && !t.archived),
    [data, project],
  );
  // The board is scoped to a project, so is the inbox shown (otherwise other projects' questions
  // would leak here; the global inbox stays on the Inbox page).
  const projectTaskIds = useMemo(
    () =>
      new Set(
        (data?.tasks ?? []).filter((t) => !project || t.projectId === project.id).map((t) => t.id),
      ),
    [data, project],
  );
  const projectInbox = inbox.filter((i) => projectTaskIds.has(i.taskId));

  const sessionByTaskId = useMemo(() => {
    const m = new Map<string, Session>();
    // Depends on `data` (stable through react-query): `sessions` is recreated on every render and
    // would invalidate the memo constantly (oxlint react-hooks/exhaustive-deps).
    const list = [...(data?.sessions ?? [])].sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
    );
    for (const s of list) m.set(s.taskId, s);
    return m;
  }, [data]);
  const agentNameByTaskId = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      const name = boot?.agents.find((a) => a.id === t.assigneeAgentId)?.name;
      if (name) m.set(t.id, name);
    }
    return m;
  }, [tasks, boot]);

  const { push } = useToast();
  const {
    columns,
    taskById,
    sensors,
    collisionDetection,
    tintColumn,
    activeTask,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useKanbanDnd(tasks, (message) =>
    push({ tone: "bad", title: BOARD_TEXT.moveRefused, body: message }),
  );

  const archiveDone = () => {
    if (!project) return undefined;
    return (
      tasksApi
        .archiveDone(project.id)
        .then(() => qc.invalidateQueries({ queryKey: qk.tasks }))
        // alert() was a design contract regression ("alert() → toasts", 19/08), caught in the toasts
        // audit of 24/08.
        .catch((e: Error) =>
          push({ tone: "bad", title: BOARD_TEXT.archiveFailed, body: e.message }),
        )
    );
  };

  // No title since 04/09: the top bar already names the screen.
  return (
    <Page>
      <Stack gap={14}>
        {/* What prevents ANY session from starting, said WHERE tasks are run (26/08). The info
            existed on the Runners screen, which nobody visits while everything looks normal. On
            26/08 a stopped Docker cost two tasks settled as failed and an hour of digging through
            Docker layers. The verdict is computed server side (infra.ts `launchBlocker`). */}
        {infra?.blocker && (
          <Banner
            tone="bad"
            title={
              infra.blocker === "daemon" ? BOARD_TEXT.blocked.daemon : BOARD_TEXT.blocked.image
            }
            actions={
              <Link render={(p) => <RouterLink to="/system/runners" {...p} />}>
                {BOARD_TEXT.blocked.infra}
              </Link>
            }
          >
            {infra.blocker === "daemon"
              ? BOARD_TEXT.blocked.daemonWhy
              : BOARD_TEXT.blocked.imageWhy}
          </Banner>
        )}
        <InboxPanel items={projectInbox} projectId={project?.id ?? ""} />
        <LauncherBar />
      </Stack>

      {/* No `align`: the grid stretches, so the five lanes form a band of equal height. That is the
          CSS default; our `Grid` used to switch it off with `align="start"`. */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* The lane picker, at the phone breakpoint only. It carries the counts: that replaces the
            glance over five bands, the most useful information of the board. */}
        {compact && (
          <ButtonGroup label={BOARD_TEXT.lanePicker} className="bo-lanes">
            {COLS.map((key) => (
              <ToggleButton
                key={key}
                size="sm"
                pressed={key === lane}
                onPressedChange={() => pickLane(key)}
                className="bo-lane"
              >
                <span className="bo-lane-label">{BOARD_TEXT.columns[key].label}</span>
                <Num value={columns[key].length} tone="muted" />
              </ToggleButton>
            ))}
          </ButtonGroup>
        )}
        <Grid cols={5} gap={12}>
          {(compact ? [lane] : COLS).map((key) => {
            const taskIds = columns[key];
            const col = BOARD_TEXT.columns[key];
            return (
              <Inset
                key={key}
                stretch
                tone={key === tintColumn ? "accent" : "recess"}
                label={
                  <Stack gap={4}>
                    {/* FIXED height (board.css): only "Done" carries a button, and without this rule
                      its header stood taller than the other four (operator feedback, 26/08). */}
                    <Row gap={6} className="bo-col-head">
                      {col.label}
                      <Spacer />
                      <Num value={`${taskIds.length} / ${tasks.length}`} tone="muted" />
                      {/* Archive all done tasks: they leave the board without being deleted */}
                      {key === TASK_STATUS.done && taskIds.length > 0 && project && (
                        <IconBtn size="sm" title={BOARD_TEXT.archiveAll} onClick={archiveDone}>
                          <Archive size={11} />
                        </IconBtn>
                      )}
                    </Row>
                    <Meter
                      bare
                      size="sm"
                      thresholds={NO_ALARM}
                      value={taskIds.length}
                      max={Math.max(tasks.length, 1)}
                      name={BOARD_TEXT.columnLoad(col.label, taskIds.length, tasks.length)}
                    />
                  </Stack>
                }
              >
                <KanbanColumnBody
                  status={key}
                  taskIds={taskIds}
                  taskById={taskById}
                  sessionByTaskId={sessionByTaskId}
                  agentNameByTaskId={agentNameByTaskId}
                  emptyTitle={col.empty}
                  emptyWhy={col.why}
                  renderActions={(t) =>
                    t.status === TASK_STATUS.done ? <ArchiveTask taskId={t.id} /> : undefined
                  }
                />
              </Inset>
            );
          })}
        </Grid>
        <DragOverlay>
          {activeTask && (
            <DraggedTaskCard
              task={activeTask}
              session={sessionByTaskId.get(activeTask.id)}
              agentName={agentNameByTaskId.get(activeTask.id)}
            />
          )}
        </DragOverlay>
      </DndContext>
    </Page>
  );
}

/** Archive a task from its card. The whole card is a link: the click must be stopped here, or
 *  archiving would also open the task. */
function ArchiveTask({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const { push } = useToast();
  return (
    <Tooltip label={BOARD_TEXT.archiveTaskWhy}>
      <Button
        variant="quiet"
        aria-label={BOARD_TEXT.archiveTask}
        leading={<Archive size={12} />}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          return (
            tasksApi
              .archiveTask(taskId, true)
              .then(() => qc.invalidateQueries({ queryKey: qk.tasks }))
              // alert(): design contract regression, caught in the toasts audit of 24/08.
              .catch((err: Error) =>
                push({ tone: "bad", title: BOARD_TEXT.archiveFailed, body: err.message }),
              )
          );
        }}
      />
    </Tooltip>
  );
}
