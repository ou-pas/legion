// What can be done to a task, in one place.
//
// The page's nine gestures (run, approve, pause, stop, delete, copy the trace, copy the resume
// command, approve a batch, open an interview) were written as `.then/.catch` INSIDE `TaskShell`'s
// JSX. The action bar was 180 lines, half of them not rendering; none of the calls could be checked
// without mounting the screen; and a gesture written twice (stop, from the bar and the panel) could
// drift silently.
//
// The hook carries no error state: refusals on this page are TOASTS since the 24/08 audit (a refused
// stop is passing news, not screen state), and also returning them would give two places to read the
// same thing. It exposes the `pending` of the gestures that disarm their control while answering.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { type Agent } from "../api/agents.js";
import { sessionsApi, type Session } from "../api/sessions.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { useInvalidateLive } from "../queries.js";
import { interviewExistingTask } from "../interviews/start-interview.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { Code } from "../ui/code.js";
import { useToast } from "../ui/toast.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import { TASK_LOT_TEXT } from "./text/lot.js";
import { traceText } from "./trace-text.js";
import { type SessionEvent } from "../sessions/use-session-events.js";

export interface TaskActions {
  /** Run. Returns its promise (16/09): the call AND the following invalidation, so the button spins
   *  until the screen shows the new state, not just until the HTTP answer (`ui/busy.ts`). */
  run: () => Promise<unknown> | undefined;
  /** Run again after a failure. The SAME call as `run`, a different refusal message: "not run again"
   *  and "not run" do not read the same right after watching the session fall. */
  relaunch: () => Promise<unknown> | undefined;
  approve: () => Promise<unknown> | undefined;
  /** Ask for a soft stop: the agent finishes its turn and pushes. */
  pause: () => Promise<unknown> | undefined;
  /** Kill. Refused by the server on an already terminal session, and that must be READABLE. */
  stop: () => Promise<unknown> | undefined;
  /** Delete for good, then go back to the project board. */
  remove: () => Promise<unknown> | undefined;
  /** The whole trace to the clipboard, as pasted into a ticket. */
  copyTrace: () => void;
  /** The command resuming the agent's conversation in YOUR terminal. Returns its promise (16/09),
   *  same reason as `run`. */
  copyResume: () => Promise<unknown> | undefined;
  /** Approve the batch of a Breakdown step in review. */
  approveLot: () => void;
  /** Give THIS task to the interviewer: it becomes the interview preparing it. */
  discuss: () => void;
  /** Gestures disarming their control while answering. `run` joined on 16/09: the keyboard shortcut
   *  (`use-launch-shortcut.ts`) bypasses the button and needs the SAME state to guard against a
   *  second run while the first is still answering. */
  pending: { lot: boolean; discuss: boolean; run: boolean };
}

export interface TaskActionsInput {
  taskId: string;
  /** `undefined` until the task is loaded: every gesture guards itself. */
  task: Task | undefined;
  agent: Agent | undefined;
  session: Session | undefined;
  events: SessionEvent[];
  /** All project agents: "discuss first" looks for the interviewer among them. */
  agents: Agent[];
  /** Refetch the batch after a verdict: a refusal comes back with ALL its faults, and the panel shows
   *  them in place of the previous batch; a toast would pile them up then lose them. */
  refetchLot: () => void;
}

/** The two gestures ending in the clipboard, not on the server. Separate because they share nothing
 *  with the others (no invalidation, navigation or `pending`): they write text the app never rereads. */
function useClipboardActions({
  task,
  agent,
  session,
  events,
}: Pick<TaskActionsInput, "task" | "agent" | "session" | "events">) {
  const { push } = useToast();

  const copyTrace = () => {
    if (!task) return;
    const text = traceText({
      taskName: task.name,
      agentName: agent?.name,
      sessionId: session?.id,
      model: session?.model,
      status: session?.status,
      events,
    });
    void navigator.clipboard
      .writeText(text)
      .then(() =>
        push({
          tone: "ok",
          title: TASK_PAGE_TEXT.toast.traceCopied,
          body: TASK_PAGE_TEXT.toast.traceCopiedBody(events.length),
        }),
      )
      .catch(() =>
        push({
          tone: "bad",
          title: TASK_PAGE_TEXT.toast.copyRefused,
          body: TASK_PAGE_TEXT.toast.copyRefusedWhy,
        }),
      );
  };

  // Take over (v11): continue the agent's conversation YOURSELF in your terminal. The toast body is a
  // `<Code>`, the only reason this module is `.tsx`: the command must be monospace, since it is
  // pasted into a terminal and a text font would lose its spaces.
  const copyResume = () => {
    if (!session) return undefined;
    return sessionsApi
      .resumeCommand(session.id)
      .then((r) =>
        navigator.clipboard.writeText(r.command).then(() =>
          push({
            tone: "ok",
            title: TASK_PAGE_TEXT.toast.resumeCopied,
            body: <Code variant="bare">{r.command}</Code>,
            duration: 10_000,
          }),
        ),
      )
      .catch((e: Error) =>
        push({ tone: "bad", title: TASK_PAGE_TEXT.toast.resumeRefused, body: e.message }),
      );
  };

  return { copyTrace, copyResume };
}

export function useTaskActions({
  taskId,
  task,
  agent,
  session,
  events,
  agents,
  refetchLot,
}: TaskActionsInput): TaskActions {
  const navigate = useNavigate();
  const { push } = useToast();
  const invalidate = useInvalidateLive();
  const [approvingLot, setApprovingLot] = useState(false);
  const [discussing, setDiscussing] = useState(false);
  // Running needs SHARED state, not only the local floor of `Button`/`IconBtn` (`ui/busy.ts`): the
  // keyboard shortcut calls `run` bypassing the button, and must guard on the SAME in-flight state
  // so a second Ctrl+Enter during the answer does not start a second session.
  const [running, setRunning] = useState(false);

  const refresh = () => invalidate(taskId);
  const refuse = (title: string) => (e: Error) => push({ tone: "bad", title, body: e.message });

  // Returns its promise (the call AND the `refresh` invalidation) so the button spins until the screen
  // shows the new state, not just the HTTP answer (D2, spec 2jan8IZn61). `queued: true` (full
  // capacity, `server/src/tasks/routes/run.ts`) now says so with a toast, as the composer already
  // does for the same gesture (`use-task-submit.ts`).
  const launch = (refusalTitle: string) => () => {
    if (!task || running) return undefined;
    setRunning(true);
    return tasksApi
      .runTask(task.id)
      .then((r) => {
        if ("queued" in r && r.queued) {
          push({
            tone: "wait",
            title: TASK_PAGE_TEXT.toast.runQueued,
            body: TASK_PAGE_TEXT.toast.runQueuedBody,
          });
        }
        return refresh();
      })
      .catch(refuse(refusalTitle))
      .finally(() => setRunning(false));
  };
  const run = launch(TASK_PAGE_TEXT.toast.runRefused);
  const relaunch = launch(TASK_PAGE_TEXT.toast.relaunchRefused);

  const approve = () => {
    if (!task) return undefined;
    return tasksApi
      .setTaskStatus(task.id, TASK_STATUS.done)
      .then(refresh)
      .catch(refuse(TASK_PAGE_TEXT.toast.approveRefused));
  };

  const pause = () => {
    if (!session) return undefined;
    return sessionsApi
      .pauseSession(session.id)
      .then(() =>
        refresh().then(() =>
          push({
            tone: "ok",
            title: TASK_PAGE_TEXT.toast.pauseAsked,
            body: TASK_PAGE_TEXT.toast.pauseAskedBody,
          }),
        ),
      )
      .catch(refuse(TASK_PAGE_TEXT.toast.pauseRefused));
  };

  // A refused stop (session already terminal, race with the natural end) must be READABLE: without
  // `catch` it was an unhandled, silent rejection (toasts audit, 24/08).
  const stop = () => {
    if (!session) return undefined;
    return sessionsApi
      .stopSession(session.id)
      .then(refresh)
      .catch(refuse(TASK_PAGE_TEXT.toast.stopRefused));
  };

  const remove = () => {
    if (!task) return undefined;
    return tasksApi
      .deleteTask(taskId)
      .then((r) => {
        push({
          tone: "ok",
          title: TASK_PAGE_TEXT.toast.deleted(r.deleted),
          body: TASK_PAGE_TEXT.toast.deletedBody(
            r.footprint.sessions,
            r.footprint.events,
            r.footprint.inbox,
          ),
        });
        return navigate({ to: "/p/$projectId/board", params: { projectId: task.projectId } });
      })
      .catch(refuse(TASK_PAGE_TEXT.toast.deleteRefused));
  };

  const { copyTrace, copyResume } = useClipboardActions({ task, agent, session, events });

  const approveLot = () => {
    setApprovingLot(true);
    void tasksApi
      .approveLot(taskId)
      .then(refresh)
      .catch(refuse(TASK_LOT_TEXT.refusedTitle))
      .finally(() => {
        setApprovingLot(false);
        refetchLot();
      });
  };

  const discuss = () => {
    if (!task) return;
    setDiscussing(true);
    void interviewExistingTask({ agents, projectId: task.projectId, taskId: task.id })
      .then((r) => {
        refresh();
        if (r.installed)
          push({
            tone: "ok",
            title: INTERVIEW_TEXT.start.installed,
            body: INTERVIEW_TEXT.start.installedBody,
          });
        push(
          r.queued
            ? { tone: "wait", title: INTERVIEW_TEXT.start.started, body: r.queued }
            : {
                tone: "ok",
                title: INTERVIEW_TEXT.start.started,
                body: INTERVIEW_TEXT.start.startedBody,
              },
        );
      })
      .catch(refuse(INTERVIEW_TEXT.start.refused))
      .finally(() => setDiscussing(false));
  };

  return {
    run,
    relaunch,
    approve,
    pause,
    stop,
    remove,
    copyTrace,
    copyResume,
    approveLot,
    discuss,
    pending: { lot: approvingLot, discuss: discussing, run: running },
  };
}
