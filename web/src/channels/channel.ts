// What a channel IS: the rule, not its drawing. A channel is a LIVE conversation (operator decision,
// 25/08): born when work starts, gone when the task is done. A note in Later is not a channel (nothing
// speaks yet); a `done` task becomes a board card again. So the list does not grow with the backlog.
//
// A channel holds NO data of its own: it reads the tasks, sessions and inbox the app already loaded.
import type { InboxItem } from "../api/inbox.js";
import type { Session } from "../api/sessions.js";
import type { TaskSummary } from "../api/tasks.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { TASK_STATUS } from "../api/tasks.js";

/** The single operator, who writes briefs and steers sessions. Named as the first message's author,
 *  with the same name in the channel and the Interview tab: two renderings of the SAME thread (D9ter). */
export const OPERATOR = "Operator";

/** waiting = waiting for you (a question or an approval) · running = working ·
 *  idle = the conversation is open but nobody speaks (session over, task not closed). */
export type ChannelState = "waiting" | "running" | "idle";

export interface Channel {
  task: TaskSummary;
  /** The task's LAST session, whose thread is read. */
  session: Session | undefined;
  state: ChannelState;
  /** The open question awaiting a HUMAN answer. A dependency wait (`wait_for_task`) or an
   *  out-of-quota pause is not one: they wake by themselves. */
  question: InboxItem | null;
  /** The task is in review: the work is deposited and awaits your look. */
  gate: boolean;
  /** The LAST session's outcome, data apart from the task status.
   *
   *  On 26/08 two `review` tasks asked for approval although their session had failed: a dead session
   *  parks the task in `review` exactly like a successful one. Status says WHERE the task is, this says
   *  WHAT HAPPENED; a true sentence needs both. */
  failure: string | null;
  /** Last sign of life: it orders the list. */
  at: number;
}

/** An inbox item REALLY awaiting a human; the other forms (dependency, out of quota) sleep on a clock
 *  or another task. Exported: the task page asks the same question, and two definitions of "waiting
 *  for you" would drift. */
export const awaitsHuman = (i: InboxItem) => i.waitForTaskId === null && i.wakeAt === null;

/** A project's live channels, sorted by section then last sign of life. */
export function liveChannels(
  tasks: TaskSummary[],
  sessions: Session[],
  inbox: InboxItem[],
  projectId: string,
): Channel[] {
  const byTask = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byTask.get(s.taskId);
    if (list) list.push(s);
    else byTask.set(s.taskId, [s]);
  }
  return tasks
    .filter((t) => t.projectId === projectId && !t.archived && t.status !== TASK_STATUS.done)
    .flatMap((task) => {
      const own = (byTask.get(task.id) ?? []).sort(
        (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
      );
      const session = own[own.length - 1];
      // No session = no channel: work has not started, nobody spoke.
      if (!session) return [];
      const question = inbox.find((i) => i.taskId === task.id && awaitsHuman(i)) ?? null;
      const gate = task.status === TASK_STATUS.review;
      const failure = session.status === "failed" ? (session.endReason ?? "") : null;
      const state: ChannelState =
        question || gate ? "waiting" : ACTIVE_STATES.includes(session.status) ? "running" : "idle";
      const at = Math.max(
        Date.parse(task.updatedAt),
        Date.parse(session.endedAt ?? session.startedAt),
      );
      return [{ task, session, state, question, gate, failure, at }];
    })
    .sort((a, b) => b.at - a.at);
}

export const SECTION_ORDER: readonly ChannelState[] = ["waiting", "running", "idle"];

/** An entry of the waiting section: a single channel, or a group VISIBLY asking the same question (seen
 *  on 04/09: the same budget question four times on four unrelated tasks). */
export type WaitingEntry =
  | { kind: "single"; channel: Channel }
  | { kind: "group"; question: string; channels: Channel[] };

/** Groups channels waiting on the SAME question, normalised (`trim().toLowerCase()`). A group needs
 *  two. Pure: no sorting or state filtering, the caller passes the `waiting` section. */
export function groupWaitingByQuestion(channels: readonly Channel[]): WaitingEntry[] {
  const byKey = new Map<string, Channel[]>();
  for (const c of channels) {
    if (!c.question) continue;
    const key = c.question.body.trim().toLowerCase();
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }

  const seen = new Set<string>();
  const entries: WaitingEntry[] = [];
  for (const c of channels) {
    const key = c.question?.body.trim().toLowerCase();
    const group = key ? byKey.get(key) : undefined;
    if (key && group && group.length >= 2) {
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ kind: "group", question: c.question!.body, channels: group });
    } else {
      entries.push({ kind: "single", channel: c });
    }
  }
  return entries;
}

/** What the list does not show and must say: today's closed conversations and the backlog. Without
 *  them an empty list looks like a failure. */
export function offstage(
  tasks: TaskSummary[],
  projectId: string,
  now: number,
): { closedToday: number; later: number } {
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const mine = tasks.filter((t) => t.projectId === projectId && !t.archived);
  return {
    closedToday: mine.filter(
      (t) => t.status === TASK_STATUS.done && Date.parse(t.updatedAt) >= dayStart,
    ).length,
    later: mine.filter((t) => t.status === TASK_STATUS.later).length,
  };
}
