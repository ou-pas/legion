// What is stopped, grouped by project (slice nav/03). The server COUNTS
// (server/src/inbox/pending-by-project.ts), this module NAMES, with the same definition: a panel
// listing something other than the badge's count would cast doubt on both. Two things stop someone:
// a still-open inbox item (`/api/inbox` returns only those) and a gated task in review.
//
// A NOTICE never enters: it stops nothing, and "a counter that never goes down stops being looked at"
// (nav work decisions).
import type { InboxItem } from "../api/inbox.js";
import type { TaskSummary } from "../api/tasks.js";
import type { RailProject } from "../projects/project-rail.js";
import { humanDuration } from "../ui/duration.js";
import { INBOX_TEXT } from "./text.js";
import { TASK_STATUS } from "../api/tasks.js";

export type PendingEntry = {
  id: string;
  /** `question`: an agent awaits an answer · `gate`: nothing moves without an approval. */
  kind: "question" | "gate";
  /** Where the click leads: always a task, and going to its task is going to its project. */
  taskId: string;
  /** The task's project, needed by its canonical URL (`/p/$projectId/tasks/$taskId`). */
  projectId: string;
  text: string;
  /** Triage line under the text: task, kind, age (mockup). */
  meta: string;
  /** For sorting: oldest first, it waited longest. */
  since: number;
  /** Where the gesture leads: the question PAGE for a round, the task otherwise (07/09). The panel does
   *  not know the router; it tells the caller what to open, the caller builds the link. */
  question: { projectId: string; inboxId: string } | null;
  /** Resume on a started draft, Answer otherwise: tells a begun decision from a blank one without
   *  reading the gauge. */
  action: string;
};

export type PendingGroup = { project: RailProject; entries: PendingEntry[] };

/** Grouped in the received PROJECT ORDER, the icon rail's: the same projects in two orders force
 *  rereading at every glance. A project with nothing stopped renders no group. */
export function pendingGroups({
  inbox,
  tasks,
  projects,
  now = Date.now(),
}: {
  inbox: InboxItem[];
  tasks: TaskSummary[];
  projects: RailProject[];
  now?: number;
}): PendingGroup[] {
  const projectOfTask = new Map(tasks.map((t) => [t.id, t.projectId]));
  const byProject = new Map<string, PendingEntry[]>();
  // The project is ALWAYS known here: an orphan question is skipped by a `continue` before the call
  // (below), and `task.projectId` is never absent.
  const add = (projectId: string, entry: PendingEntry) => {
    const list = byProject.get(projectId);
    if (list) list.push(entry);
    else byProject.set(projectId, [entry]);
  };

  for (const item of inbox) {
    // Open is not enough: someone must have to decide (slice nav/11). A session sleeping on another
    // task (`waitForTaskId`) or until a time (`wakeAt`) wakes by itself. Listing them would disagree
    // with the badge, which does not count them (server/src/inbox/pending-by-project.ts).
    if (item.waitForTaskId !== null || item.wakeAt !== null) continue;
    // A question whose task is not loaded has no known project: skipped BEFORE building the entry, not
    // filtered afterwards in `add`.
    const projectId = projectOfTask.get(item.taskId);
    if (!projectId) continue;
    // v62 (07/09): the count in a round's meta ("AI-2200 · 2 / 6 · 1 h 52"), what decides whether to
    // resume now. `total === 0` = a text or choice question: no gauge.
    const round = item.total > 0;
    const age = humanDuration(now - item.createdAt);
    add(projectId, {
      id: `q-${item.id}`,
      kind: "question",
      taskId: item.taskId,
      projectId,
      text: item.body,
      meta: round
        ? INBOX_TEXT.pending.roundMeta(item.taskName, item.answered, item.total, age)
        : INBOX_TEXT.pending.questionMeta(item.taskName, age),
      since: item.createdAt,
      // A round leads to its page; a text or choice question is answered in its channel or task, so
      // the click leads to the task.
      question: round && item.projectId ? { projectId: item.projectId, inboxId: item.id } : null,
      action: item.answered > 0 ? INBOX_TEXT.card.resume : INBOX_TEXT.card.answer,
    });
  }

  for (const task of tasks) {
    if (!task.approvalGate || task.status !== TASK_STATUS.review) continue;
    // An unreadable date would show "NaN min": fall back to now, so "0 min".
    const parsed = Date.parse(task.updatedAt);
    const since = Number.isNaN(parsed) ? now : parsed;
    add(task.projectId, {
      id: `g-${task.id}`,
      kind: "gate",
      taskId: task.id,
      projectId: task.projectId,
      text: INBOX_TEXT.pending.gateText(task.name),
      meta: INBOX_TEXT.pending.gateMeta(task.name, humanDuration(now - since)),
      since,
      // A gate is not a question: approved on the task, no page to open, nothing to resume.
      question: null,
      action: INBOX_TEXT.pending.approve,
    });
  }

  return projects
    .filter((p) => byProject.has(p.id))
    .map((p) => ({
      project: p,
      entries: [...byProject.get(p.id)!].sort((a, b) => a.since - b.since),
    }));
}
