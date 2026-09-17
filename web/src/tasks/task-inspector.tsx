// A task's right panel (04/09, "flat" mock-up): open by default, it carries what is neither the
// contract nor the run: what is SET before running, what is OBSERVED after.
//
// Two faces, never both: while no session has run, the settings (title, agent, complexity, priority,
// guardrails); once a session exists, the runtime (runner, container, model, cost, branch, PR,
// dependencies) with the session id at the foot. The switch the operator asked for.
//
// "Settings" therefore left the task's view rail: a task is not set up while reading it. The
// `/settings` route itself was removed (nav work, batch G, 12/09): this panel is its only home.
import { useEffect, useState } from "react";
import { ExternalLink, Square, Timer, X } from "lucide-react";
import { type Agent } from "../api/agents.js";
import { type InfraRunner } from "../api/infra.js";
import { parseJsonOr } from "../api/json.js";
import { type ModelChoice } from "../api/models.js";
import { type Project } from "../api/projects.js";
import { type Session } from "../api/sessions.js";
import { type ExternalRef, type Task } from "../api/tasks.js";
import { CostValue } from "../sessions/cost.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { Button, IconBtn } from "../ui/button.js";
import { Tag } from "../ui/chip.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Heading } from "../ui/heading.js";
import { KeyValue, KeyValueList } from "../ui/key-value.js";
import { Link } from "../ui/link.js";
import { Inset } from "../ui/inset.js";
import { SidePanel } from "../ui/side-panel.js";
import { Caption } from "../ui/text.js";
import { elapsed, pushedRepos, runsOf, SEC, sessionOutcome, workMs } from "./session-facts.js";
import { prUrlsOf } from "./pr-state.js";
import { taskBranch } from "./task-branch.js";
import { COMPLEXITY_LABEL, PRIORITY_LABEL, TaskSettings } from "./TaskSettings.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";
import { type TimelineEvent } from "./trace-text.js";
import "./task-inspector.css";

/** The container only exists during `running` / `committing`: in an inbox pause it is destroyed by
 *  design, and before start it does not exist yet. */
const CONTAINER_STATES: readonly string[] = ["running", "committing"];

/** The current time, to the second, while `ticking`; frozen otherwise. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const handle = window.setInterval(() => setNow(Date.now()), SEC);
    return () => window.clearInterval(handle);
  }, [ticking]);
  return now;
}

export function TaskInspector({
  task,
  agents,
  project,
  models,
  session,
  taskSessions = [],
  active,
  events,
  taskEvents = [],
  runners,
  onClose,
  onSaved,
  onOpenTimeline,
  onStop,
}: {
  task: Task;
  agents: Agent[];
  project?: Project;
  /** For the settings' model override selector (v2c, nav). Not loaded (`undefined`): the selector
   *  waits rather than guessing the list, same rule as the tool catalogue. */
  models?: ModelChoice[];
  session?: Session;
  /** All the task's sessions, `session` included: their sum is the task cost. With a single one (the
   *  default) the total would repeat the session row, so it is not shown. */
  taskSessions?: Session[];
  active: boolean;
  events: TimelineEvent[];
  /** The stream of ALL the task's sessions. Only the task work time derives from it: cost is read on
   *  session rows, which remain the reference even when a `result` is missing from the trace. */
  taskEvents?: TimelineEvent[];
  runners: InfraRunner[];
  onClose: () => void;
  onSaved: () => void;
  /** The runtime face's two gestures: read the trace, stop what runs. `onStop` absent means nothing
   *  runs and the button does not exist (never greyed out). */
  onOpenTimeline: () => void;
  onStop?: () => void;
}) {
  const runtime = session !== undefined;
  const title = runtime ? T.inspector.runtimeTitle : T.inspector.settingsTitle;
  /** The external reference (Linear…), read tolerantly: unreadable means no chip, not a blank page
   *  (`api/json.ts`). Moved from the task header on 10/09: it is about what a session knows of the
   *  task, so it joined the panel already carrying the container. */
  const externalRef = parseJsonOr<ExternalRef | null>(task.externalRef, null);
  return (
    // The panel is a design system `SidePanel` (ui/side-panel.tsx); the page only composes its head,
    // body and foot with design system primitives. No custom class.
    <SidePanel
      label={title}
      head={
        <Row align="flex-start" gap={8}>
          <Stack gap={2}>
            <Heading level={3}>{title}</Heading>
            <Caption>{runtime ? T.inspector.runtimeSub : T.inspector.settingsSub}</Caption>
            {externalRef && (
              <Link variant="plain" href={externalRef.url} target="_blank" rel="noreferrer">
                <Tag>{externalRef.identifier}</Tag>
                <ExternalLink size={11} aria-hidden="true" />
              </Link>
            )}
          </Stack>
          <Spacer />
          {/* No state badge here: the page header already carries it (operator feedback, 04/09). */}
          <IconBtn title={T.inspector.close} onClick={onClose} small>
            <X size={14} />
          </IconBtn>
        </Row>
      }
      foot={
        <Stack gap={10}>
          {session && (
            <Stack gap={6}>
              <Button leading={<Timer size={13} />} onClick={onOpenTimeline}>
                {T.inspector.actions.timeline}
              </Button>
              {onStop && (
                <Button variant="danger" leading={<Square size={13} />} onClick={onStop}>
                  {T.inspector.actions.stop}
                </Button>
              )}
            </Stack>
          )}
          <Row gap={8}>
            <Caption>{runtime ? T.inspector.sessionId : T.inspector.taskId}</Caption>
            <Spacer />
            <Tag>{session?.id ?? task.id}</Tag>
          </Row>
        </Stack>
      }
    >
      {session ? (
        <Runtime
          task={task}
          session={session}
          taskSessions={taskSessions}
          agents={agents}
          events={events}
          taskEvents={taskEvents}
          runners={runners}
        />
      ) : (
        <TaskSettings
          task={task}
          agents={agents}
          project={project}
          models={models}
          active={active}
          session={session}
          onSaved={onSaved}
        />
      )}
    </SidePanel>
  );
}

// Runtime insets show FACTS read from the DTO and the trace, never inferred. An unknown value is
// written "—": a panel omitting a row suggests it does not exist.

/** Branch and last commit. The branch is a LINK to its PR when there is one, otherwise a name. The
 *  repo is only named when there are several, as in the banner. */
function GitInset({ task, events }: { task: Task; events: TimelineEvent[] }) {
  const branch = taskBranch(task);
  /** The branch's PR, the first one: a single-repo task only has one. */
  const pr = prUrlsOf(task)[0];
  const pushed = pushedRepos(events);
  return (
    <Inset label={T.inspector.groups.git}>
      <KeyValueList density="compact">
        <KeyValue label={T.inspector.keys.branch}>
          {branch === null ? (
            T.inspector.none
          ) : pr ? (
            <Link href={pr.url} target="_blank" rel="noreferrer" title={pr.url}>
              {branch}
            </Link>
          ) : (
            <Tag title={branch}>{branch}</Tag>
          )}
        </KeyValue>
        {pushed.length > 0 && (
          <KeyValue label={T.inspector.keys.commit}>
            {pushed.map((p) => (
              <span key={p.repo} className="tsk-inspector-push">
                {pushed.length > 1 && p.repo} <Tag>{p.commit}</Tag>
              </span>
            ))}
          </KeyValue>
        )}
      </KeyValueList>
    </Inset>
  );
}

/** Settings, read-only (05/09, operator feedback: "a setting is not a detail, clicking settings means
 *  wanting to see the setting again"). Frozen once the session started, as the note says, but
 *  readable, with the form's words (TaskSettings). */
function SettingsInset({ task, agents }: { task: Task; agents: Agent[] }) {
  return (
    <Inset label={T.inspector.groups.settings}>
      <KeyValueList density="compact">
        <KeyValue label={T.inspector.keys.agent}>
          {agents.find((a) => a.id === task.assigneeAgentId)?.name ?? T.inspector.none}
        </KeyValue>
        <KeyValue label={T.inspector.keys.complexity}>{COMPLEXITY_LABEL[task.complexity]}</KeyValue>
        <KeyValue label={T.inspector.keys.priority}>{PRIORITY_LABEL[task.priority]}</KeyValue>
        <KeyValue label={T.inspector.keys.modelOverride}>
          {task.modelOverride ?? T.inspector.none}
        </KeyValue>
        <KeyValue label={T.inspector.keys.gate}>
          {task.approvalGate ? T.inspector.yes : T.inspector.no}
        </KeyValue>
        <KeyValue label={T.inspector.keys.readOnly}>
          {task.readOnly ? T.inspector.yes : T.inspector.no}
        </KeyValue>
      </KeyValueList>
      <Caption>{T.inspector.settingsFrozen}</Caption>
    </Inset>
  );
}

/** What holds the task back, and where each blocker stands. Nothing at all when it is free. */
function DepsInset({ task }: { task: Task }) {
  if (task.blockedBy.length === 0) return null;
  return (
    <Inset label={T.inspector.groups.deps}>
      <KeyValueList density="compact">
        {task.blockedBy.map((b) => (
          <KeyValue key={b.id} label={b.name}>
            <Tag>{b.status}</Tag>
          </KeyValue>
        ))}
      </KeyValueList>
    </Inset>
  );
}

/** Where it runs: machine, container, agent. The container only exists in some states (asleep while
 *  the session lives, gone once it ends), and saying so avoids a `docker exec` on a name that no
 *  longer exists. */
function MachineInset({
  session,
  runners,
  agents,
  live,
}: {
  session: Session;
  runners: InfraRunner[];
  agents: Agent[];
  live: boolean;
}) {
  const runner = runners.find((r) => r.runnerId === session.runnerId);
  const agent = agents.find((a) => a.id === session.agentId);
  return (
    <Inset label={T.inspector.groups.machine}>
      <KeyValueList density="compact">
        <KeyValue label={T.inspector.keys.runner}>
          {runner?.runnerName ?? session.runnerId}
        </KeyValue>
        <KeyValue label={T.inspector.keys.container}>
          {CONTAINER_STATES.includes(session.status) ? (
            <Tag>{`legion-session-${session.id}`}</Tag>
          ) : (
            <Caption>{live ? T.inspector.containerAsleep : T.inspector.containerGone}</Caption>
          )}
        </KeyValue>
        <KeyValue label={T.inspector.keys.agent}>{agent?.name ?? T.inspector.none}</KeyValue>
      </KeyValueList>
    </Inset>
  );
}

function Runtime({
  task,
  session,
  taskSessions,
  agents,
  events,
  taskEvents,
  runners,
}: {
  task: Task;
  session: Session;
  taskSessions: Session[];
  agents: Agent[];
  events: TimelineEvent[];
  taskEvents: TimelineEvent[];
  runners: InfraRunner[];
}) {
  const { numTurns, endReason } = sessionOutcome(session, events);
  /** Per-run detail read from the trace, the ONLY place it exists: the session row keeps just the sum.
   *  The trace loaded here is `session`'s, so the runs shown are its own; earlier sessions only count
   *  in the total. */
  const runs = runsOf(events);
  const taskCostUsd = taskSessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const work = workMs(runs);
  const api = workMs(runs, "api");
  /** The TASK's work: the runs of all its sessions. A task's wall clock is not computed: the gap
   *  between sessions is review time, dependency wait, or nothing, and summing them would say
   *  nothing. */
  const taskWork = workMs(runsOf(taskEvents));
  const live = ACTIVE_STATES.includes(session.status);
  // The duration TICKS while the session runs, frozen otherwise, same clock as the verdict: state and
  // an interval, never `Date.now()` during render (render must be pure).
  const now = useNow(live);
  const ended = session.endedAt ? Date.parse(session.endedAt) : now;
  return (
    // <Inset>s rather than custom blocks (operator feedback, 04/09): THE recessed block of the design
    // system, with its small-caps label, geometry and surfaces already decided.
    <Stack gap={12} className="tsk-runtime">
      <MachineInset session={session} runners={runners} agents={agents} live={live} />
      <Inset label={T.inspector.groups.model}>
        <KeyValueList density="compact">
          <KeyValue label={T.inspector.keys.model}>
            <Tag>{session.model}</Tag>
          </KeyValue>
          {/* ONE ROW PER RUN when the session was resumed (10/09). The SDK bills each `query()`
              separately: three runs are three invoice lines, and the session row kept only the last.
              Detail here, total below. A single-run session shows nothing more. */}
          {runs.length > 1 &&
            runs.map((r) => (
              <KeyValue key={r.index} label={`${T.inspector.keys.run} ${r.index}`}>
                <CostValue usd={r.costUsd} tone={r.failed ? "muted" : "default"} />
                {r.numTurns !== null && ` · ${r.numTurns} ${T.inspector.keys.turnsShort}`}
                {r.durationMs !== null && ` · ${elapsed(r.durationMs)}`}
              </KeyValue>
            ))}
          <KeyValue label={T.inspector.keys.cost}>
            {typeof session.costUsd === "number" ? (
              <CostValue usd={session.costUsd} tone="default" />
            ) : (
              T.inspector.none
            )}
          </KeyValue>
          {/* The TASK TOTAL once it has run more than once: rerunning creates a fresh session, and the
              panel showed only the last, $2.82 shown for $9.55 spent on `wB1HyQZzDF`. */}
          {taskSessions.length > 1 && (
            <KeyValue label={T.inspector.keys.taskCost}>
              <CostValue usd={taskCostUsd} tone="default" />
              {` · ${taskSessions.length} ${T.inspector.keys.sessionsShort}`}
            </KeyValue>
          )}
          {taskSessions.length > 1 && taskWork !== null && (
            <KeyValue label={T.inspector.keys.taskWork}>{elapsed(taskWork)}</KeyValue>
          )}
          <KeyValue label={T.inspector.keys.turns}>{numTurns ?? T.inspector.none}</KeyValue>
          {/* Wall clock and work, one under the other (10/09). The wall clock runs from start to end,
              so it includes waits between resumes: eleven hours on `uI2d0wsDLd9w` for twenty minutes
              of work. The gap is that wait, a fact about the organisation, not the agent. */}
          <KeyValue label={T.inspector.keys.duration}>
            {elapsed(ended - Date.parse(session.startedAt))}
          </KeyValue>
          {work !== null && <KeyValue label={T.inspector.keys.work}>{elapsed(work)}</KeyValue>}
          {api !== null && <KeyValue label={T.inspector.keys.workApi}>{elapsed(api)}</KeyValue>}
          {endReason && <KeyValue label={T.inspector.keys.end}>{endReason}</KeyValue>}
        </KeyValueList>
      </Inset>
      <GitInset task={task} events={events} />
      <SettingsInset task={task} agents={agents} />
      <DepsInset task={task} />
    </Stack>
  );
}
