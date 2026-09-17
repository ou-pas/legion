// A session's verdict (proposal C, 23/08): what happened, what is left to decide. It absorbs the old
// "currently" HUD (live session), the old ErrorState (failure) and the PR draft reminder: one state
// block, four faces depending on the session.
//
// Split from `TaskPage.tsx`, derivations pushed into `session-facts.ts`: what remains is the DRAWING
// of each face. Also the only place on the page where a control's absence is a decision (the
// steering field only exists during `running`), now checkable without mounting the page.
import { useEffect, useState } from "react";
import { Link as RouterLink } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  FileText,
  GitMerge,
  GitPullRequest,
  Hourglass,
  Info,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { type RunnerSummary } from "../api/infra.js";
import { type InboxItem as InboxQueueItem } from "../api/inbox.js";
import { type Session } from "../api/sessions.js";
import { type Task } from "../api/tasks.js";
import { PrMark } from "../review/pr-mark.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { SessionVerdict, VerdictFact } from "../sessions/session-verdict.js";
import { SteerField } from "../sessions/steer-field.js";
import { SESSION_TEXT } from "../sessions/text.js";
import { ToolCall } from "../sessions/tool-call.js";
import { Button } from "../ui/button.js";
import { Tag } from "../ui/chip.js";
import { Row } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { LOCALE } from "../ui/locale.js";
import { Num } from "../ui/num.js";
import { Caption } from "../ui/text.js";
import {
  elapsed,
  pendingSince,
  pendingTool,
  pushedRepos,
  SEC,
  sessionOutcome,
} from "./session-facts.js";
import { TaskImageRebuild } from "./task-image-rebuild.js";
import { prMergeStatesQuery } from "./pr-merge-state-query.js";
import { prSolidarity, solidarityMessage } from "./pr-solidarity.js";
import { RunnerChoice } from "./runner-choice.js";
import { TASK_TEXT } from "./text/vocabulary.js";
import { TASK_RUN_TEXT } from "./text/task-run.js";
import { type TimelineEvent } from "./trace-text.js";
import { SESSION_STATUS } from "../api/sessions.js";

/** "Sun 23:13": the scheduled wake-up of an out-of-quota pause (v28). */
const WAKE_AT_VERDICT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// oxlint-disable-next-line complexity -- session state machine: one verdict per state, and the ORDER of cases is the rule (dependency, out of quota, turn budget, question, then live, then ended); the first that applies wins
export function TaskVerdict({
  task,
  session,
  events,
  pendingPr,
  prUrls,
  quotaPause,
  agentName,
  runners,
  onSteer,
  onOpenPr,
  onOpenArtifacts,
  onRelaunch,
  onRunnerChosen,
}: {
  task: Task;
  session?: Session;
  events: TimelineEvent[];
  pendingPr: boolean;
  prUrls: { repo: string; url: string }[];
  /** v66: the fleet, to pick the machine of the NEXT session when running again. Absent (stories,
   *  fleet not loaded yet): the control is not rendered, nothing else moves. */
  runners?: RunnerSummary[];
  /** v28: the OPEN inbox entry carrying a scheduled wake-up for THIS session (non-null `wakeAt`): out
   *  of quota, or inertia pause (10/09). The name predates the second cause: `reason` decides which
   *  one the verdict says, never "waiting for you" for either. */
  quotaPause: InboxQueueItem | null;
  /** Whom you talk to while the session runs: the steering field names it. */
  agentName?: string;
  /** Steering (v23): absent means no session to talk to. Rejects with the server's sentence. */
  onSteer?: (text: string) => Promise<unknown>;
  onOpenPr: () => void;
  onOpenArtifacts: () => void;
  onRelaunch: () => void;
  /** The task's machine just changed: refetch it. */
  onRunnerChosen?: () => void;
}) {
  // The counter ticks while running, frozen otherwise.
  const running = Boolean(session && ACTIVE_STATES.includes(session.status));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const handle = window.setInterval(() => setNow(Date.now()), SEC);
    return () => window.clearInterval(handle);
  }, [running]);

  // PR merge states: required before any conditional return (rules of hooks).
  const mergeStates = useQuery(prMergeStatesQuery(task.id, prUrls.length > 0));

  // A task never run has no verdict: the action bar already offers "Run", and the Trace view explains
  // the emptiness.
  if (!session) return null;

  const { succeeded, endReason, runError } = sessionOutcome(session, events);

  // Inertia pause criterion 8 (10/09): a chain of resumes must read without opening the trace,
  // whatever the session state, and it is while still running that a chain of relaunches goes most
  // unnoticed. Silent at zero.
  const resumeFact =
    session.resumeCount > 0 ? (
      <Num value={session.resumeCount} suffix={TASK_RUN_TEXT.verdict.resumes} tone="muted" />
    ) : null;
  // What the panel owns is no longer repeated here (14/09, operator feedback). Cost, turns, duration,
  // agent, model and branch live in "Runtime & context", their owner, which names and aligns them;
  // the banner repeated them as unlabelled chips an inch away. What remains is what the panel does
  // not say: the verdict, the PR state and the resume count.
  const meta = <>{resumeFact}</>;

  // Live session: where it stands, since when.
  if (running) {
    const pending = pendingTool(events);
    const since = pendingSince(pending, session);
    if (session.status === SESSION_STATUS.waiting) {
      // wait_for_task (v26) reuses the same `waiting` pause (container destroyed, resume on a fresh
      // clone) but there is NOTHING to do: the session wakes up on its own once the target task is
      // done. A verdict saying "waiting for you" would lie. The steering field below stays active
      // (answering wakes it earlier), but that is not the expected path.
      const waiting = task.waitingFor;
      if (waiting) {
        return (
          <SessionVerdict
            tone="wait"
            title={TASK_RUN_TEXT.verdict.waitDependency}
            meta={
              <Row gap={6}>
                <Caption>{TASK_RUN_TEXT.verdict.since}</Caption>
                <Num value={elapsed(now - waiting.since)} />
                {resumeFact}
              </Row>
            }
          >
            <VerdictFact icon={<Hourglass />}>
              {TASK_RUN_TEXT.verdict.waitsFor}{" "}
              <Link
                render={(p) => (
                  <RouterLink
                    to="/p/$projectId/tasks/$taskId"
                    params={{ projectId: task.projectId, taskId: waiting.waitForTaskId }}
                    {...p}
                  />
                )}
              >
                “{waiting.waitForTaskName}”
              </Link>
              {waiting.waitForTaskStatus !== null && (
                <>
                  {" "}
                  — <Tag>{TASK_TEXT.status[waiting.waitForTaskStatus]}</Tag>
                </>
              )}{" "}
              — {TASK_RUN_TEXT.verdict.waitsForWhy}
            </VerdictFact>
          </SessionVerdict>
        );
      }
      // v28, OUT-OF-QUOTA pause: "waiting for you" would lie, nobody has anything to do. The session
      // sleeps, the wake-up is SCHEDULED (window reset + margin); the steering field below allows an
      // earlier resume.
      //
      // Keyed on the reason, not merely on `wakeAt` (10/09): the inertia pause sets a `wakeAt` too
      // (next tick), and mixing them up would show "out of quota" on a turns relaunch.
      if (quotaPause?.reason === "quota-pause" && quotaPause.wakeAt) {
        return (
          <SessionVerdict
            tone="wait"
            title={TASK_RUN_TEXT.verdict.outOfQuota}
            meta={
              <Row gap={6}>
                <Caption>{TASK_RUN_TEXT.verdict.wakesAlone}</Caption>
                <Num value={WAKE_AT_VERDICT.format(new Date(quotaPause.wakeAt))} />
                {resumeFact}
              </Row>
            }
          >
            <VerdictFact icon={<AlarmClock />}>{TASK_RUN_TEXT.verdict.outOfQuotaWhy}</VerdictFact>
          </SessionVerdict>
        );
      }
      // Inertia pause (10/09): the session progressed to the end of its turn budget and restarts on
      // its own, no question. Same rail as the out-of-quota pause, different cause.
      if (quotaPause?.reason === "turn-relaunch") {
        return (
          <SessionVerdict tone="wait" title={TASK_RUN_TEXT.verdict.turnBudget} meta={meta}>
            <VerdictFact icon={<RefreshCw />}>{TASK_RUN_TEXT.verdict.turnBudgetWhy}</VerdictFact>
          </SessionVerdict>
        );
      }
      // D7 (15/09): nothing to add to the title, the answer panel sits right below.
      return <SessionVerdict tone="wait" title={TASK_RUN_TEXT.verdict.waitingAnswer} meta={meta} />;
    }
    // Steering (v23): the field ONLY exists during `running`, the only state where a runtime listens
    // (server/src/sessions/steering.ts). In the other two live states a mute field is not greyed out:
    // it is absent, and the reason is written just above. A disabled control with a native `title`
    // says nothing (Chrome, Safari).
    const listening = session.status === "running" && onSteer !== undefined;
    return (
      <SessionVerdict
        tone="run"
        title={SESSION_TEXT.status[session.status] ?? session.status}
        meta={
          <Row gap={6}>
            <Caption>{TASK_RUN_TEXT.verdict.since}</Caption>
            <Num value={elapsed(now - since)} />
            {resumeFact}
          </Row>
        }
        actions={listening ? <SteerField onSend={onSteer} agentName={agentName} /> : undefined}
      >
        {/* This line ALWAYS exists while the session runs, even with no tool in progress (26/08). It
            used to depend on `pending`, so it came and went on every `tool_start` / `tool_end`,
            several times a minute, moving the steering field below by 17px. Aiming at a field that
            moves while clicking is the same fault as a neighbour sliding under the cursor (see
            confirm-action.tsx): stable height is what makes the control reachable. */}
        {(pending || session.status === "running") && (
          <VerdictFact icon={<Terminal />}>
            {/* Same rule as the trace: readable IN ONE SECOND, never raw JSON. */}
            {pending ? (
              <>
                {TASK_RUN_TEXT.verdict.doing}{" "}
                <ToolCall
                  tool={String(pending.data.tool ?? TASK_RUN_TEXT.verdict.someTool)}
                  input={typeof pending.data.input === "string" ? pending.data.input : undefined}
                />
              </>
            ) : (
              SESSION_TEXT.steer.thinking
            )}
          </VerdictFact>
        )}
        {session.status === "starting" && (
          <VerdictFact icon={<MessageSquare />}>{TASK_RUN_TEXT.verdict.startingWhy}</VerdictFact>
        )}
        {session.status === "committing" && (
          <VerdictFact icon={<MessageSquare />}>{TASK_RUN_TEXT.verdict.committingWhy}</VerdictFact>
        )}
      </SessionVerdict>
    );
  }

  // Ended session: the verdict and the facts.
  const mergeStateOf = (repo: string, url: string) =>
    mergeStates.data?.find((m) => m.repo === repo && m.url === url);
  // Solidarity: `null` on a single-request task, nothing to say in the common case. Same derivation
  // as the PR tab, on the same data (`mergeStates`).
  const solidarityMsg = solidarityMessage(prSolidarity(prUrls, mergeStates.data));

  // ONE repo is not named; TWO, each is named (04/09). The repo name distinguishes nothing when the
  // task pushes one (the ordinary case), and it is the only thing distinguishing two lines otherwise.
  const pushed = pushedRepos(events);
  const single = pushed.length <= 1;
  const facts = (
    <>
      {/* No identity nor branch here (14/09): "Runtime & context" carries agent, model and branch.
        Only the REPO NAME remains, and only with two repos: the panel describes the session, not
        each of its pushes. */}
      {!single &&
        pushed.map((p) => (
          <VerdictFact key={p.repo} shrink>
            <span>{p.repo}</span>
          </VerdictFact>
        ))}
      {/* The PR as ONE ICON: shape and colour (GitHub) give the state, the number says which. No
        more "open", "mergeable", or repo when alone: three chips for one fact that nobody read
        any more (operator feedback, 04/09). */}
      {prUrls.map((p) => {
        const ms = mergeStateOf(p.repo, p.url);
        return (
          <VerdictFact key={p.url}>
            <PrMark
              url={p.url}
              number={ms?.number}
              state={ms?.prState}
              mergeState={ms?.mergeState}
              repo={single ? undefined : p.repo}
            />
          </VerdictFact>
        );
      })}
      {solidarityMsg && (
        <VerdictFact icon={<GitMerge />}>
          {solidarityMsg.title}
          {solidarityMsg.body && <> — {solidarityMsg.body}</>}
        </VerdictFact>
      )}
      {pendingPr && (
        <VerdictFact
          icon={<GitPullRequest />}
          end={
            <Button size="sm" onClick={onOpenPr}>
              {TASK_RUN_TEXT.verdict.openDraft}
            </Button>
          }
        >
          {TASK_RUN_TEXT.verdict.draftWaiting}
        </VerdictFact>
      )}
      {/* No end reason on a SUCCESS: "the agent process exited with code 0" says nothing the verdict
        does not. It stays on other endings, where it carries the cause. */}
      {endReason && !succeeded && (
        <VerdictFact icon={<Info />}>{TASK_RUN_TEXT.verdict.closed(endReason)}</VerdictFact>
      )}
    </>
  );

  if (session.status === "failed") {
    return (
      <SessionVerdict
        tone="bad"
        title={TASK_RUN_TEXT.verdict.failed}
        meta={meta}
        actions={
          <>
            {task.blockedBy.length === 0 && (
              <Button variant="primary" leading={<RotateCcw size={13} />} onClick={onRelaunch}>
                {TASK_RUN_TEXT.verdict.relaunch}
              </Button>
            )}
            {/* Machine choice lives HERE (v66): "not that one, the other" is decided while reading
              the failure, before pressing "Run again". Absent while the fleet is not loaded, or with
              a single machine. */}
            {runners && runners.length > 1 && onRunnerChosen && (
              <RunnerChoice task={task} runners={runners} onChosen={onRunnerChosen} />
            )}
            {/* A missing image is rebuilt from here (12/09), where the cause is already written.
              Silent when no image is awaited, by far the most frequent case. */}
            <TaskImageRebuild taskId={task.id} wait={task.imageWait} />
            <Button leading={<FileText size={13} />} onClick={onOpenArtifacts}>
              {TASK_RUN_TEXT.verdict.seeArtifacts}
            </Button>
          </>
        }
      >
        {/* The cause first. `endReason` carries it since v22; `run_error` refines it for older
            sessions or when the runner said more than the manager. */}
        {!endReason && runError && (
          <VerdictFact icon={<Info />}>
            {String(runError.data.message ?? TASK_RUN_TEXT.verdict.errorNoMessage)}
          </VerdictFact>
        )}
        {facts}
        <VerdictFact>{TASK_RUN_TEXT.verdict.stillIn(TASK_TEXT.status[task.status])}</VerdictFact>
      </SessionVerdict>
    );
  }

  // ONE LINE (04/09): an ended session has nothing left to decide and does not take three lines above
  // the view. Verdict, branch, PR and measures side by side.
  return (
    <SessionVerdict
      compact
      tone={succeeded ? "ok" : "neutral"}
      title={succeeded ? TASK_RUN_TEXT.verdict.succeeded : TASK_RUN_TEXT.verdict.ended}
      meta={meta}
    >
      {facts}
    </SessionVerdict>
  );
}
