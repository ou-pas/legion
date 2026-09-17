// A task's shell: its head, and where its view renders.
//
// It carried nine tabs on a card sitting at the NINTH BLOCK of a stack. Since slice nav/17 each view
// is a route and this page is their parent: it renders what depends on no view, then an `<Outlet />`.
// A parent route with an `<Outlet />` IS a fixed head followed by a view scrolling alone.
//
// What the head keeps, and nothing else: the title and its gestures, the verdict, and what ASKS for a
// decision now (the inbox question, the interview exit, the batch to approve, the blockers explaining
// why "Run" is missing). Everything descriptive went down into a view (`task-screens.tsx`).
//
// The SSE stream lives here, which is why it did not move: the shell survives view changes, so does
// the connection. In a view, every rail click would reopen an EventSource and the server would replay
// the whole trace.
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type Agent } from "../api/agents.js";
import { sessionsApi, type Session } from "../api/sessions.js";
import { type Project } from "../api/projects.js";
import { type Task } from "../api/tasks.js";
import {
  artifactsQuery,
  bootstrapQuery,
  inboxQuery,
  infraQuery,
  modelsQuery,
  runnersQuery,
  taskLinksQuery,
  taskLotQuery,
  taskQuery,
  tasksQuery,
  useInvalidateLive,
} from "../queries.js";
import { TaskInspector } from "./task-inspector.js";
import { Drawer } from "../ui/drawer.js";
import { usePublishTaskFacts } from "./task-facts.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { type SessionEvent, type SessionStream } from "../sessions/use-session-events.js";
import { useTaskEvents } from "../sessions/use-task-events.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import { Row, Stack } from "../ui/flex.js";
import { COMPACT_QUERY, useMediaQuery } from "../ui/use-media-query.js";
import { unmetPrerequisite } from "./prerequisite.js";
import { TaskAbsent } from "./task-absent.js";
import { TaskBlockersPanel } from "./task-blockers.js";
import { TaskLotPanel } from "./task-lot.js";
import { Page } from "../ui/page.js";
import { ToastProvider, useToast } from "../ui/toast.js";
import { InboxPanel } from "../inbox/InboxPanel.js";
import { awaitsHuman } from "../channels/channel.js";
import { transcript, type Segment } from "../channels/transcript.js";
import { InterviewExit } from "../interviews/interview-exit.js";
import { isInterviewTask } from "../interviews/interview.js";
// What the page NO LONGER does itself: moving (rule AND control), trace vocabulary, session facts,
// view decision, PR flow state, reading the SSE stream, and since slice 17 rendering the views. Each
// module is checkable without mounting this screen, the blind spot of its former 1213 lines.
import { TaskActionsBar } from "./task-actions-bar.js";
import { TaskHeader } from "./task-header.js";
import { useTaskActions } from "./use-task-actions.js";
import { agentReport, TASK_VIEW_PATH } from "./task-views.js";
import { useResolveTaskView } from "./use-task-view.js";
import {
  hasPrTab as computeHasPrTab,
  pendingPr as computePendingPr,
  prUrlsOf,
} from "./pr-state.js";
import { pushedRepos } from "./session-facts.js";
import { TaskAttempts } from "./task-attempts.js";
import { TaskVerdict } from "./task-verdict.js";
import "./task-page.css";
import { TASK_STATUS } from "../api/tasks.js";

/** Types whose arrival changes the DTO (task, session), not only the trace: invalidate, or the screen
 *  waits for the next poll (paused out of focus). "status" included: session transitions drive the
 *  header chip live. `dependency_wait`/`dependency_resolved` (v26): `task.waitingFor` comes from the
 *  task DTO, not the stream, so without invalidating the verdict would stay on the old state. */
const INVALIDATING_TYPES: readonly string[] = [
  "status",
  "task_status",
  "result",
  "inbox_ask",
  "inbox_answer",
  "fs_op",
  "dependency_wait",
  "dependency_resolved",
];

/** What the shell derived, and every view rereads.
 *
 *  "Shell" and not "View": the `TaskTab → TaskView` rename of slice 17 gave the same word three
 *  meanings in one domain (a view id in `task-views.ts`, the shell mounting them all, and the shared
 *  state), and `useTaskView()` did not return a `TaskView`. The TYPE keeps `TaskView`, the domain
 *  concept; the shell and its context are named "shell".
 *
 *  A context rather than a route parameter: what views share is not in the URL, it is the SSE stream
 *  and what derives from it. Passing it through the router would mean serialising it; redoing it in
 *  each view would reopen a connection per click.
 *
 *  What is NOT in it is deliberate: whatever a view can ask React Query again (artifacts, lineage,
 *  notes, bootstrap) is asked again, since the key is the same and the cache answers without a
 *  request. A context carrying everything becomes a second data model. */
export interface TaskShellState {
  task: Task;
  agent: Agent | undefined;
  session: Session | undefined;
  /** A session runs: the brief can no longer be edited, the trace may be cut. */
  active: boolean;
  events: SessionEvent[];
  stream: SessionStream;
  reconnect: () => void;
  /** The agent's last text, and whether it counts as a summary (`available`). */
  report: { text: string; available: boolean };
  /** The task is carried by the interviewer: the thread IS the work. */
  interview: boolean;
  segments: Segment[];
  /** There is something to do PR-wise: a draft, an open PR, or pushed code. */
  hasPr: boolean;
  refresh: () => void;
}

const TaskShellContext = createContext<TaskShellState | null>(null);

/** The PROVIDER, exported (06/09) so the views can mount outside the router, which `task-screens.tsx`
 *  needed for its stories. Not a back door: it sets the complete state, of the same type the shell
 *  derives; a test setter would let a view mount on a state production never produces. */
export const TaskShellProvider = TaskShellContext.Provider;

/** Read by the views. Throws rather than returning `null`: a view mounted outside its shell is a route
 *  tree error, not a screen state, and a mute panel would not say so. */
export function useTaskShell(): TaskShellState {
  const ctx = use(TaskShellContext);
  if (!ctx) throw new Error("useTaskShell outside a task page");
  return ctx;
}

/** Nothing mounts a <ToastProvider> at the root, so the page carries its own, for the copy gesture to
 *  confirm instead of staying silent. */
export function TaskPage() {
  return (
    <ToastProvider>
      <TaskShell />
    </ToastProvider>
  );
}

/** The runtime panel: a column when there is room, a drawer when there is not.
 *
 *  Stacked under the conversation (what the grid does under 1100px) it had neither edge nor surface:
 *  its header ran edge to edge while the content above kept the page gutters. Seen on an iPhone.
 *
 *  A drawer answers both: it has its own surface, so alignment stops being a question, and it PUSHES
 *  nothing (this panel is five hundred pixels, a whole screen). It also brings the focus trap and
 *  Escape `ui/drawer.tsx` already handles.
 *
 *  `onClose` is passed TWICE, to the drawer and the panel, on purpose: the panel's cross and the
 *  drawer's backdrop are two gestures the operator can make, and both must close. */
function InspectorSurface({
  compact,
  onClose,
  children,
}: {
  compact: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!compact) return children;
  return (
    <Drawer
      label={TASK_PAGE_TEXT.inspector.runtimeTitle}
      className="tsk-inspector-drawer"
      onClose={onClose}
    >
      {children}
    </Drawer>
  );
}

/** The head: one row when there is room, a stack when there is not. A component rather than a ternary
 *  in the render: both branches carry the SAME children, which a component says without copying the
 *  action bar's twenty props. */
function HeadRow({ compact, children }: { compact: boolean; children: ReactNode }) {
  if (compact) return <Stack gap={12}>{children}</Stack>;
  return (
    <Row align="flex-start" gap={16}>
      {children}
    </Row>
  );
}

/** "Discuss first" is only offered while NOTHING HAS RUN: afterwards the interview would come behind
 *  the work it was meant to prepare. Never on a task that already is the interview, a blocked task, a
 *  demo project task, or a task already started. */
function canTakeOverForInterview(p: {
  task: Task;
  session?: Session;
  project?: Project;
  interview: boolean;
}): boolean {
  if (p.interview || p.session || p.project?.demo) return false;
  if (p.task.blockedBy.length > 0) return false;
  return p.task.status === TASK_STATUS.todo || p.task.status === TASK_STATUS.later;
}

// oxlint-disable-next-line complexity -- task page shell: twelve queries each bringing its `?? default` until it answers, and one derived fact per rail view; each fact's logic already lives in its module
function TaskShell() {
  // A task's address carries its project (slice nav/13): `tasks.project_id` has always been
  // `NOT NULL`, and `/tasks/<id>` said otherwise. The old address redirects here.
  const { projectId, taskId } = useParams({ from: "/p/$projectId/tasks/$taskId" });
  const navigate = useNavigate();
  // Title and gestures do not fit on one line at 393px (13/09). The six gestures keep their width, the
  // title gets the rest (fifty pixels), and its text overflowed UNDER the toolbar. Seen on an iPhone
  // 16, reproduced and fixed at 393.
  //
  // Stack rather than `wrap`: `flex-wrap` only triggers when children do not FIT, and the title
  // shrinks instead of forcing a break (tried, measured, no effect). In JavaScript rather than CSS
  // because `Row` sets its direction inline: flipping it from a sheet would need `!important`.
  const compact = useMediaQuery(COMPACT_QUERY);
  const { push } = useToast();
  const { data: boot } = useQuery(bootstrapQuery);
  const { data } = useQuery(tasksQuery);
  // The FULL record of THIS task (brief, criteria): the list above only carries the summary since the
  // 02/09 cut. `data` stays the source of SESSIONS, and of lineage/links that only need ids.
  const { data: task } = useQuery(taskQuery(taskId));
  const { data: inbox = [] } = useQuery(inboxQuery);
  const invalidate = useInvalidateLive();
  // Artifacts are fetched HERE and not only in their view: `pr.md` decides the bar's "Create PR"
  // button and the verdict's draft reminder, both in the head.
  const { data: artifactsForPr = [] } = useQuery(artifactsQuery(taskId));
  // LINEAGE (25/08): where this task comes from, what it proposed. The head reads one thing from it,
  // the unmet prerequisite making approval two steps. The panel went down into the "Brief" view; both
  // share the cache key, so one request.
  const { data: links } = useQuery(taskLinksQuery(taskId));
  // The right panel (04/09): settings while nothing has run, runtime afterwards; the session decides
  // the face, not a tab. The action bar's gear folds it; the state does not survive the page.
  // Open by default on a wide screen, closed on a phone (14/09, operator request): as a column it
  // costs nothing, stacked under the thread it PUSHES what you came to read off screen. An initial
  // state and not a derived one: it can be opened on a phone and must not close on the next render.
  const [inspectorOpen, setInspectorOpen] = useState(!compact);
  // The runner name, for the panel: the session only carries its id.
  const { data: infra } = useQuery(infraQuery);
  // The fleet as a short list (v66): enough to PICK the next session's machine, next to "Run again".
  // Distinct from `infraQuery`, which probes docker on every host for the Runners page.
  const { data: runners } = useQuery(runnersQuery);
  // For the settings' model override (v2c, nav), same query as an agent's sheet.
  const { data: modelList } = useQuery(modelsQuery);
  /** The prerequisite this task declares and that is not done, making approval two steps. `null`
   *  while lineage is not loaded: nothing gets armed on empty. */
  const unmetPrereq = unmetPrerequisite(links);
  // The batch is only fetched where it can exist: a chain step IN REVIEW. The `approvesLot` flag lives
  // in the template, not the task row, so the server answers `approvesLot: false` on every other task
  // and the panel renders nothing.
  const { data: lot, refetch: refetchLot } = useQuery(
    taskLotQuery(taskId, task?.status === TASK_STATUS.review && task.stepIndex !== null),
  );
  /** The task's sessions in start order. The whole list, not just the last: a task's cost is the sum
   *  of its sessions, which the right panel could not say while it saw only one. */
  const taskSessions = useMemo(
    () =>
      (data?.sessions ?? [])
        .filter((s) => s.taskId === taskId)
        .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    [data, taskId],
  );
  const session = taskSessions[taskSessions.length - 1];
  // The WHOLE task's stream: history of all its sessions, plus the live one. Same hook as the Channels
  // view (`useTaskEvents`), so the same merge on `dbId` and no second SSE stream: the past reads in one
  // request, the present stays on the live session's SSE. Stream state (`stream`) stays distinct from
  // session state: a trace that stops moving because the stream dropped looks exactly like a session
  // doing nothing, and that silence is what we show.
  //
  // The page used to read `useSessionEvents(session?.id)`, the LAST session only: nothing could say
  // what a rerun task had cost or how long it had been worked on.
  const {
    events: taskEvents,
    stream,
    reconnect,
  } = useTaskEvents(taskId, session?.id, (type) => {
    if (INVALIDATING_TYPES.includes(type)) invalidate(taskId);
  });
  /** The DISPLAYED session's events. Everything judging the current session takes these and only
   *  these: its report, verdict, pushed repos. Without the filter, a rerun session dying silently
   *  would show the previous session's report as its own. */
  const events = useMemo(
    () => (session ? taskEvents.filter((e) => e.sessionId === session.id) : []),
    [taskEvents, session],
  );
  const agent = boot?.agents.find((a) => a.id === task?.assigneeAgentId);
  const project = boot?.projects.find((p) => p.id === task?.projectId);
  const taskInbox = inbox.filter((i) => i.taskId === taskId);
  /** Discussion mode (D9ter): an interview task has a view rendering THE SAME thread as its channel.
   *  Segments are computed here, not in the view: they derive from the SSE stream the shell carries. */
  const interview = isInterviewTask(task, agent);
  const segments = useMemo(() => transcript(events), [events]);
  /** The OPEN round, if any: the exit gesture sits next to IT (D10). */
  const openRound = taskInbox.find(awaitsHuman);
  const active = Boolean(session && ACTIVE_STATES.includes(session.status));
  // The report reads as a document in its own view, opened by default once the session is over: the
  // page first answers "what happened?".
  const report = agentReport(events, { hasSession: Boolean(session), active });
  // Number of pushed files, for the badge on the rail's "PR" rank (`task-facts.ts`).
  usePublishTaskFacts(taskId, events);

  // The bare address resolves, and a view that stops existing leads back to the same place: both are
  // the same navigation (`use-task-view.ts`), so never an empty screen.
  useResolveTaskView({
    enabled: Boolean(task),
    interview,
    hasReport: report.available,
    hasSession: Boolean(session),
  });
  // The nine gestures, in their module (`use-task-actions.tsx`). They were `.then/.catch` on each
  // button's line: the action bar was 180 lines, half not rendering, with "stop" written twice.
  const actions = useTaskActions({
    taskId,
    task,
    agent,
    session,
    events,
    agents: boot?.agents ?? [],
    refetchLot: () => void refetchLot(),
  });

  if (!task) return <TaskAbsent />;
  const prUrls = prUrlsOf(task);
  const artifactNames = artifactsForPr.map((a) => a.name);
  // Pushed code is enough to open a PR since slice nav/12, so view and button no longer depend on a
  // `pr.md`. The fact is already derived from the trace by `pushedRepos` (session-facts.ts), the one
  // the server reads in the events.
  const pushedCode = pushedRepos(events).length > 0;
  const hasPr = computeHasPrTab(artifactNames, prUrls, pushedCode);
  const pendingPr = computePendingPr(prUrls, pushedCode);

  // The armed delete label counts sessions: they carry the trace and the cost, and "delete a task" is
  // not decided like "delete 4 sessions".
  const sessionCount = taskSessions.length;

  /** Jump to a view. Gestures that opened a tab (`setTab`) became NAVIGATIONS: a button leading
   *  nowhere raises no type error. */
  const open = (to: (typeof TASK_VIEW_PATH)[keyof typeof TASK_VIEW_PATH]) =>
    void navigate({ to, params: { projectId, taskId }, search: {} });

  const canDiscuss = canTakeOverForInterview({ task, session, project, interview });

  const state: TaskShellState = {
    task,
    agent,
    session,
    active,
    events,
    stream,
    reconnect,
    report,
    interview,
    segments,
    hasPr,
    refresh: () => invalidate(taskId),
  };

  return (
    <Page className="tsk-page">
      {/* TWO COLUMNS (04/09): head and view on the left, settings/runtime panel on the right (see
          `task-inspector.tsx`). Height runs through `.tsk-body` then `.tsk-main` down to the view. */}
      <div className="tsk-body">
        <div className="tsk-main">
          {/* The title, as in the validated mock-up (04/09): at card title size, not the `Page`
          template (3xl title), since the top bar already names the screen. */}
          <Stack gap={12} className="tsk-head">
            {/* The title GROWS and wraps; the bar keeps its width on the same line (operator
          feedback, 04/09). Both halves are modules since 06/09 (`task-header.tsx`,
          `task-actions-bar.tsx`): 180 lines in the middle of the shell, none checkable without
          mounting the whole screen. */}
            <HeadRow compact={compact}>
              <TaskHeader task={task} />
              <TaskActionsBar
                task={task}
                session={session}
                active={active}
                sessionCount={sessionCount}
                unmetPrereq={unmetPrereq}
                eventCount={events.length}
                pendingPr={pendingPr}
                canDiscuss={canDiscuss}
                inspectorOpen={inspectorOpen}
                actions={actions}
                onToggleInspector={() => setInspectorOpen((open) => !open)}
                onOpenPr={() => open(TASK_VIEW_PATH.pr)}
                onMoved={() => invalidate(taskId)}
                onMoveError={(e: Error) =>
                  push({ tone: "bad", title: TASK_PAGE_TEXT.move.refused, body: e.message })
                }
              />
            </HeadRow>

            {/* The verdict (proposal C, 23/08): what happened, what is left to decide. It absorbs the
            "currently" HUD (live session), the old ErrorState (failure) and the PR draft reminder.
            One block, always in the same place, visible from any view. */}
            <TaskVerdict
              task={task}
              session={session}
              events={events}
              pendingPr={pendingPr}
              prUrls={prUrls}
              quotaPause={
                inbox.find((i) => i.sessionId === session?.id && i.wakeAt !== null) ?? null
              }
              agentName={agent?.name}
              // Steering: the promise goes back as is to the field, which shows the server's refusal
              // in full. Nothing to invalidate: the user turn comes back through the SSE stream.
              onSteer={
                session ? (text: string) => sessionsApi.steerSession(session.id, text) : undefined
              }
              onOpenPr={() => open(TASK_VIEW_PATH.pr)}
              onOpenArtifacts={() => open(TASK_VIEW_PATH.artifacts)}
              onRelaunch={actions.relaunch}
              runners={runners}
              onRunnerChosen={() => invalidate(taskId)}
            />

            {/* Past attempts, under the verdict of the one that matters (13/09). The verdict above is
            the LAST session's, rightly, but a task that failed twice before succeeding told it
            nowhere. Folded: most tasks have a single attempt, and the component renders nothing. */}
            <TaskAttempts sessions={taskSessions.slice(0, -1)} />

            <InboxPanel items={taskInbox} projectId={projectId} />

            {/* D10, the exit gesture NEXT TO the form: on this page the round form lives in the
            register above (the view's thread does not repeat it). Only rendered when a round really
            waits: elsewhere there is nothing to conclude. */}
            {interview && openRound && <InterviewExit questionId={openRound.id} />}

            {/* What HOLDS the task: "blocked by N" on the card, which ones here (behaviour 8). It stays
            in the HEAD, not a view, because it explains the missing "Run" button just above. Renders
            nothing when nothing holds it. */}
            <TaskBlockersPanel blockers={task.blockedBy} projectId={projectId} />

            {/* The BATCH, on a Breakdown step in review: the proposed slices and the only gesture
            ending the step (behaviour 5). It asks for a decision now, so it sits in the head. The
            panel renders nothing if the step approves no batch, which only the server knows. A
            refusal comes back with its faults and replaces the batch shown. */}
            <TaskLotPanel
              lot={lot ?? null}
              busy={actions.pending.lot}
              onApprove={actions.approveLot}
            />
          </Stack>

          {/* The VIEW, scrolling alone. One screen is mounted because only one is there: what
          `<Tabs unmountInactive={false}>` bought by hand for the PR tab, routes give everywhere. */}
          <div className="tsk-view">
            <TaskShellContext value={state}>
              <Outlet />
            </TaskShellContext>
          </div>
        </div>
        {/* A DRAWER ON A PHONE (14/09). Stacked under the conversation this panel had neither edge
            nor surface: its header ran edge to edge while the content above kept the page gutters.
            A drawer has its own surface, shadow, focus trap and Escape, and pushes nothing. Above
            the breakpoint nothing changes: it is the third column, as since 26/08. */}
        {inspectorOpen && (
          <InspectorSurface compact={compact} onClose={() => setInspectorOpen(false)}>
            <TaskInspector
              task={task}
              agents={boot?.agents ?? []}
              project={project}
              models={modelList?.models}
              session={session}
              taskSessions={taskSessions}
              active={active}
              events={events}
              taskEvents={taskEvents}
              runners={infra?.runners ?? []}
              onClose={() => setInspectorOpen(false)}
              onSaved={() => invalidate(taskId)}
              onOpenTimeline={() => open(TASK_VIEW_PATH.timeline)}
              onStop={active && session ? actions.stop : undefined}
            />
          </InspectorSurface>
        )}
      </div>
    </Page>
  );
}
