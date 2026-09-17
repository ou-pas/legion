import { json, post, patch } from "./client.js";
import type { Session } from "./sessions.js";

/** Who spoke on a task's activity feed, mirror of `ACTIVITY_FROM`. `system` is the control plane
 *  itself: attributing it to an agent would suggest a model decided what the server did alone. */
export const ACTIVITY_FROM = { agent: "agent", human: "human", system: "system" } as const;
export const ACTIVITY_FROMS = [
  ACTIVITY_FROM.agent,
  ACTIVITY_FROM.human,
  ACTIVITY_FROM.system,
] as const;
export type ActivityFrom = (typeof ACTIVITY_FROMS)[number];

export type ExternalRef = {
  provider: string;
  issueId: string;
  identifier: string;
  url: string;
  branch?: string;
};
/** v50. The three conventionalbranch.org types this repo emits. Mirror of
 *  `server/src/tasks/task-branch.ts`: the package boundary is not crossed. */
export const BRANCH_TYPE = { feature: "feature", bugfix: "bugfix", chore: "chore" } as const;
export const BRANCH_TYPES = [BRANCH_TYPE.feature, BRANCH_TYPE.bugfix, BRANCH_TYPE.chore] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];
/** What deleting a task destroys. Narrower than a project footprint: a task owns no agents or repos. */
export type TaskFootprint = { sessions: number; events: number; inbox: number; activity: number };
/** v26. What the task page and the inbox state plainly when the task's session sleeps on a
 *  dependency (`wait_for_task`, server/src/sessions/wait-for-task.ts): which task, in which state,
 *  since when (`since`, ms timestamp: the start of the displayed timer, not a local clock). Computed
 *  by the server (`task-serialize.ts`) like `editable`; the client never re-derives the rule.
 *  `waitForTaskStatus` is `null` only when the target was deleted without a wake-up (hand-repaired
 *  database). */
export type TaskWaitDto = {
  inboxId: string;
  waitForTaskId: string;
  waitForTaskName: string;
  waitForTaskStatus: Task["status"] | null;
  since: number;
};
/** 12/09. The chosen machine lacks the session image, so nothing can start there. The card said
 *  "queued", implying a machine would take it: that was false. Computed by the server
 *  (`task-serialize.ts`) like `waitingFor`, `null` once the wait lifts. `rebuilding` holds for ALL
 *  tasks waiting on that image: the same rebuild unblocks them all. */
export type TaskImageWait = { image: string; runnerName: string; rebuilding: boolean };
/** v44. A task holding this one back, NAMED: enough to count it on the card, list it on the page and
 *  open it. A link = blocked, whatever status is shown next to it: unblocking is an event consumed
 *  when the blocker is done, not a state the screen recomputes. */
export type TaskBlocker = { id: string; name: string; status: Task["status"] };
/** 12/09. Why the queue SKIPS this task instead of launching it: its machine does not answer or is
 *  out of disk, and no Legion button fixes that (unlike a missing image, rebuilt in one click).
 *  Without this, the "queued" badge would promise a seat that never frees.
 *  server/src/infra/runner/unavailability.ts holds the fact, `task-serialize.ts` computes it, the
 *  client never re-derives it. */
export type TaskRunnerWaitDto = {
  runnerId: string;
  runnerName: string;
  reason: "docker-down" | "disk-full";
  message: string;
  since: number;
};
/** A task's two scales, spelled THE SAME: `low | med | high` is a complexity or a priority depending
 *  on the column. That is exactly why they are named: a literal does not say which, and they decide
 *  different things. Complexity routes the MODEL, priority orders the PICKUP. Mirror of
 *  `server/src/tasks/task-scales.ts`. */
export const COMPLEXITY = { low: "low", med: "med", high: "high" } as const;
export const COMPLEXITIES = [COMPLEXITY.low, COMPLEXITY.med, COMPLEXITY.high] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

export const PRIORITY = { low: "low", med: "med", high: "high" } as const;
export const PRIORITIES = [PRIORITY.low, PRIORITY.med, PRIORITY.high] as const;
export type Priority = (typeof PRIORITIES)[number];

/** The five task statuses, in board column order. Mirror of `TASK_STATUSES`
 *  (server/src/tasks/lifecycle.ts): the two halves share only a STRING, never a type (see
 *  `make contract`). A named list, unlike the old inline union, can be iterated for columns, labels
 *  and order. */
export const TASK_STATUS = {
  /** The only parking, and it never moves by itself: a consumed dependency link does not take a
   *  task out of it. */
  later: "later",
  todo: "todo",
  doing: "doing",
  /** The sink of every ending. What tells them apart is `settledOutcome`, not this status. */
  review: "review",
  done: "done",
} as const;

export const TASK_STATUSES = [
  TASK_STATUS.later,
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.done,
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** v56. What AUTOMATIC settling observed, when the server settled the task rather than its agent.
 *  Mirror of `SettledOutcome` (server/src/tasks/lifecycle.ts).
 *
 *  `null` carries meaning: the agent settled itself through `update_task`, or no automatic path
 *  ever settled the task. That separates "it finished and said so" from "we observed its end". The
 *  observation is cleared on every relaunch: it describes the previous ending, never the current. */
export const SETTLED_OUTCOMES = ["delivered", "empty", "failed", "stopped"] as const;
export type SettledOutcome = (typeof SETTLED_OUTCOMES)[number];

export type Task = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: TaskStatus;
  /** v56. `null` means "no observation", not "all is well". See `SETTLED_OUTCOMES`. */
  settledOutcome: SettledOutcome | null;
  assigneeAgentId: string | null;
  modelOverride: string | null;
  approvalGate: boolean;
  /** v53. The session clones its repos with `access: "read"`, so nothing is pushed and no PR opens.
   *  For audit/validation tasks, set at creation or amended while the task is `editable`. */
  readOnly: boolean;
  /** Points to the INSTALLED `task_templates` that produced this step (a project copy, see
   *  `chains/catalog.ts`), possibly gone if the chain was since removed from the project:
   *  `ChainRunPage` must compose without it. */
  templateId: string | null;
  templateRunId: string | null;
  stepIndex: number | null;
  goalId: string | null;
  archived: boolean;
  complexity: Complexity;
  priority: Priority;
  queued: boolean;
  prUrls: string; // JSON [{repo,url}], PRs created from pr.md (v8)
  externalRef: string | null; // JSON {provider,issueId,identifier,url} (v9)
  // Drizzle timestamps serialize as ISO strings over JSON (review P3 #1) — compare via Date.parse.
  expectedArtifacts: string;
  scheduledAt: string | null;
  /** v46. A slice's contract written in advance, JSON `{ validatedBy, items: [{ text, mode, edge? }] }`
   *  (decoded by `tasks/criteria.ts`). `null` = none. A task carrying one is a gated step: its agent
   *  hands it to review and the operator finishes it. */
  criteria: string | null;
  /** v50. The task's branch, FIXED by the server at its first derivation (`tasks/lifecycle.ts`).
   *  `null` = never derived, no branch yet. The client displays it and never computes it: a branch
   *  recomputed here would change on any rename and stop pointing at the work already pushed. */
  branch: string | null;
  /** v66. The machine designated for FUTURE sessions (`runners.id`). `null` = none, the default:
   *  the control plane chooses. A value is a HARD choice: the queue routes only there and refuses
   *  naming the machine if it does not answer, never falling back. Changing it never touches the
   *  running session, which keeps the runner it reserved. */
  chosenRunnerId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Card rank in its column (v21, `tasks.board_order`), ascending = top. Fractional: the client
   *  never computes a rank, it sends the drop index to `POST /api/tasks/:id/move`. */
  boardOrder: number;
  /** Computed by the server (`task-serialize.ts`); the client NEVER re-derives these rules.
   *  `editable` covers structural settings (title, agent, gate, complexity, priority): true only in
   *  `later`/`todo`, with no live session, outside the demo project.
   *  `briefEditable` covers `description` only: wider, frozen only by a live session (decided in
   *  `bd8ce68`: amending then relaunching stays legitimate). */
  editable: boolean;
  briefEditable: boolean;
  /** `null` unless the task's session sleeps on a dependency, see `TaskWaitDto`. */
  waitingFor: TaskWaitDto | null;
  /** `null` unless something waits on an image, see `TaskImageWait`. */
  imageWait: TaskImageWait | null;
  /** Tasks still holding this one back (`task_blockers`, computed in `task-serialize.ts`). Empty =
   *  free. Several since v44: a batch's slices all block the Wiki step. */
  blockedBy: TaskBlocker[];
  /** `null` unless the machine side holds the task, see `TaskRunnerWaitDto`. */
  runnerWait: TaskRunnerWaitDto | null;
};
/** What a board card (or a chain rail, or a channel) shows: never the brief or the criteria.
 *  Measured 02/09: `GET /api/tasks` returned 108 WHOLE records (`description` up to 20,000
 *  characters, `criteria` as JSON) to paint cards showing three chips, ~460 KB refetched by the
 *  safety net every 60 s (`queries.ts`). The list now returns THIS; the full record has its own route
 *  (`tasksApi.task`, `taskQuery`) that only the task page requests. See
 *  `server/src/tasks/task-serialize.ts`. */
export type TaskSummary = Omit<Task, "description" | "criteria">;
/** Structural settings of an unstarted task: what `TaskComposer` sets at creation and
 *  `PATCH /api/tasks/:id` accepts besides status/archived/description (server/src/tasks/task-edit.ts).
 *  Refused (400/404/409) while `task.editable` is false. */
export type TaskPatch = {
  status?: Task["status"];
  archived?: boolean;
  description?: string;
  name?: string;
  agentId?: string;
  approvalGate?: boolean;
  readOnly?: boolean;
  complexity?: Task["complexity"];
  priority?: Task["priority"];
  /** v2c (nav). Forces a model for this task. `null` hands back to complexity routing; absent
   *  touches nothing. A structural setting: same editability guard as complexity/priority, unlike
   *  `chosenRunnerId` below. */
  modelOverride?: string | null;
  /** v66. `null` removes the choice; absent touches nothing. Its editability rule is the BRIEF's,
   *  not the settings': only a live session refuses it (409), not a started status, since switching
   *  machines then relaunching is the use case. */
  chosenRunnerId?: string | null;
  /** Add/remove blockers on an `editable` task (server/src/tasks/task-blocker-edit.ts). Two lists,
   *  never a full list: a replacement would silently overwrite a link set meanwhile by a chain or
   *  `propose_task` that this caller does not know about yet. */
  addBlockerIds?: string[];
  removeBlockerIds?: string[];
};
/** `kind` says how to PREVIEW without guessing from the name: "text" keeps the iframe rendering,
 *  "image" an `<img>`, "binary" a download link. Rule in `server/src/tasks/artifact-mime.ts`. */
export type Artifact = {
  name: string;
  size: number;
  mimeType: string;
  kind: "text" | "image" | "binary";
};

/** A brief ATTACHMENT: an OPERATOR file stored under `attachments/` in the task's artifacts folder.
 *  Same shape as an artifact (same channel) plus the `path` the agent reads in its brief. DIRECTION
 *  separates them, not format: an artifact comes up from the agent, an attachment goes down from the
 *  human. */
export type Attachment = Artifact & { path: string };

/** What an attachment upload REPORTS (07/09): the file is stored regardless, and `notified` says
 *  whether the running session was told through a steer (`steered`) or nobody was (`none`, with the
 *  reason: no session, or a runtime no longer listening). The server attempted the steer; the screen
 *  does not guess the session state. */
export type AttachmentUpload = { attachment: Attachment; replaced: boolean } & (
  | { notified: "steered"; sessionId: string }
  | { notified: "none"; reason: string }
);

/** A slice of the batch deposited by the breakdown step, as the server returns it. The server
 *  COERCES: the artifact comes from an agent and a faulty batch is still returned, so a missing or
 *  mistyped field arrives as an empty string rather than an `unknown` the screen would re-guard line
 *  by line. `faults` say what is wrong. */
export type LotSlice = {
  label: string;
  outcome: string;
  validatedBy: string;
  items: { text: string; mode: string; edge?: string }[];
  blockedBy: number[];
};
/** The batch read at THIS instant, with all its faults. Empty `faults` = approvable. A missing or
 *  unreadable artifact yields a batch without slices and a fault that names itself. */
export type Lot = {
  /** False = this step does not approve a batch (the flag lives in the template, not the task row:
   *  the screen cannot know before asking). Nothing to render. */
  approvesLot: boolean;
  slices: LotSlice[];
  faults: string[];
};

/** The single entry point for `PATCH /api/tasks/:id`; `setTaskStatus`/`setTaskDescription`/
 *  `archiveTask` are special cases of it. */
const patchTask = (id: string, body: TaskPatch): Promise<Task> => patch(`/api/tasks/${id}`, body);

/** A task's lineage (25/08): where it came from, what it spawned. Computed by the server, notably
 *  `suggestedAgentId`, which decides whether the child can start in one gesture. */
export interface TaskLink {
  id: string;
  name: string;
  status: Task["status"];
  /** The agent actually assigned. `null` on a task deposited by an agent: it never is. */
  agentName: string | null;
  suggestedAgentName: string | null;
  /** null = the suggestion no longer names a project agent. The screen then offers to open the task
   *  rather than a button that would fail at launch. */
  suggestedAgentId: string | null;
  /** The lineage is a DEPENDENCY: the parent is blocked by the child
   *  (`propose_task({ blocking: true })`). Carried by both ends of the link. */
  blocksParent: boolean;
}

export interface TaskLinks {
  parent: TaskLink | null;
  children: TaskLink[];
}

export const tasksApi = {
  /** Summaries, not records (02/09 cut), see `TaskSummary`. */
  tasks: (): Promise<{ tasks: TaskSummary[]; sessions: Session[] }> =>
    fetch("/api/tasks").then(json),
  /** ONE task's full record, brief and criteria included, requested by the task page apart from the
   *  list. */
  task: (id: string): Promise<Task> => fetch(`/api/tasks/${id}`).then(json),
  /** `status: "later"` records the task without committing it: it lands in Later and no automatic
   *  path (queue, scheduler) will take it. */
  createTask: (body: {
    name: string;
    description?: string;
    agentId: string;
    projectId: string;
    approvalGate?: boolean;
    readOnly?: boolean;
    complexity?: "low" | "med" | "high";
    priority?: "low" | "med" | "high";
    status?: "todo" | "later";
    type?: BranchType;
    externalRef?: ExternalRef;
    blockerIds?: string[];
  }): Promise<Task> => post("/api/tasks", body),
  /** Composer classification (#35): a haiku control call PROPOSES agent/chain, complexity and gate
   *  from title + brief. Creates NOTHING, never blocks (guaranteed fallback within 3 s, with the
   *  server's reason "repli"). The operator's hand always wins. */
  classifyTask: (body: {
    projectId: string;
    name: string;
    description?: string;
    /** Pins: a hand-chosen field is a CONSTRAINT for the classifier, which proposes the others
     *  around it and never overwrites the pin (server contract). */
    forced?: {
      agentId?: string | null;
      templateId?: string | null;
      complexity?: "low" | "med" | "high" | null;
      gate?: boolean | null;
    };
  }): Promise<{
    kind: "agent" | "chain";
    agentId: string | null;
    templateId: string | null;
    complexity: "low" | "med" | "high";
    gate: boolean;
    /** v50. The conventionalbranch.org type that will name the branch. The classifier's fallback
     *  returns `chore`: there is no "no type" case. */
    type: BranchType;
    reason: string;
  }> => post("/api/tasks/classify", body),
  /** Deletes the task, its sessions, events and questions. Refused (409) while a session works: the
   *  message names which. */
  deleteTask: (id: string): Promise<{ ok: true; deleted: string; footprint: TaskFootprint }> =>
    fetch(`/api/tasks/${id}`, { method: "DELETE" }).then(json),
  /** `queued: true` (202) says capacity was full: the queue will take it, no session started
   *  (`server/src/tasks/routes/run.ts`). The client type lacked the field until 16/09, so the task
   *  page got the response without being able to read it. */
  runTask: (id: string): Promise<{ sessionId: string } | { queued: true }> =>
    post(`/api/tasks/${id}/run`),
  /** Rebuilds the image holding this task back. The screen names neither machine nor image: the
   *  server already holds them (`task.imageWait`) and knows which rebuild (fleet or project)
   *  applies. Returns at once; `imageWait.rebuilding` takes over on the next `GET /api/tasks/:id`.
   *  Refused (409) if the wait lifted between display and click. */
  rebuildTaskImage: (id: string): Promise<{ image: string; runnerName: string }> =>
    post(`/api/tasks/${id}/rebuild-image`),
  /** Refused (400/404/409, see `TaskPatch`) while `task.editable`/`briefEditable` is false on the
   *  server; the screen never retests the rule, it reads the field. */
  updateTask: (id: string, body: TaskPatch): Promise<Task> => patchTask(id, body),
  /** Talks to a task WITHOUT a live session: the message is appended to the brief and RELAUNCHES the
   *  task, so the agent reads it at startup (`server/src/tasks/task-message.ts`).
   *
   *  Distinct from `steerSession`, which talks to a RUNNING runtime without restarting it, and from
   *  `updateTask({ description })`, which replaces an instruction without launching anything. The
   *  server refuses (409) while a session works, pointing to steering in plain words.
   *
   *  `sessionId` names the started session; `queued: true` says capacity was full and the queue
   *  will take it. Both are successes. */
  sendMessage: (
    id: string,
    text: string,
  ): Promise<{ ok: true; sessionId: string | null; queued: boolean }> =>
    post(`/api/tasks/${id}/message`, { text }),
  setTaskStatus: (id: string, status: Task["status"]) => patchTask(id, { status }),
  taskLinks: (id: string): Promise<TaskLinks> => fetch(`/api/tasks/${id}/links`).then(json),
  /** The batch proposed by a breakdown step, READ FROM DISK now: a new agent deposit replaces the
   *  previous one, so the screen never caches it longer than its page. Refused (400) on a step that
   *  does not approve a batch. */
  taskLot: (id: string): Promise<Lot> => fetch(`/api/tasks/${id}/lot`).then(json),
  /** The single gesture: creates the slices with their blockers, makes the next step wait on all of
   *  them, and finishes the breakdown step, all or nothing. Refused (422) on a faulty batch with all
   *  its faults; refused (409) if the step is not in review or already done. */
  approveLot: (id: string): Promise<{ created: string[] }> => post(`/api/tasks/${id}/approve-lot`),
  /** Assign THEN commit, in that order. A task moved to `todo` without an agent enters a queue where
   *  its launch will fail: for the operator the two gestures are one. */
  adoptChild: async (id: string, agentId: string) => {
    await patchTask(id, { agentId });
    return patchTask(id, { status: "todo" });
  },
  /** Kanban drag & drop (v21, server/src/tasks/task-move.ts): POSITION as well as status, in one
   *  server transaction. `index` = 0-based position in the TARGET column, moved task excluded,
   *  sorted by ascending `boardOrder`: exactly the index of a list reordered by dnd-kit, no rank
   *  computed client-side. */
  moveTask: (
    id: string,
    body: { status: Task["status"]; index: number },
  ): Promise<{ task: Task; rebalanced: boolean }> => post(`/api/tasks/${id}/move`, body),
  /** Refused (409) while a session works: its spec already left, rewriting it would change nothing
   *  for it and the screen would lie about the instruction received. */
  setTaskDescription: (id: string, description: string): Promise<Task> =>
    patchTask(id, { description }),
  archiveTask: (id: string, archived: boolean) => patchTask(id, { archived }),
  archiveDone: (projectId: string): Promise<{ archived: number }> =>
    post("/api/tasks/archive-done", { projectId }),
  artifacts: (taskId: string): Promise<Artifact[]> =>
    fetch(`/api/tasks/${taskId}/artifacts`).then(json),
  artifactUrl: (taskId: string, name: string) =>
    `/api/tasks/${taskId}/artifacts/${encodeURIComponent(name)}`,
  /** Content goes up as base64 INSIDE the JSON, the artifact binary channel's transport, never a
   *  parallel multipart. The server NORMALISES the name (accents, spaces) and returns the one it
   *  kept: display that one. */
  attachments: (taskId: string): Promise<Attachment[]> =>
    fetch(`/api/tasks/${taskId}/attachments`).then(json),
  attachmentUrl: (taskId: string, name: string) =>
    `/api/tasks/${taskId}/attachments/${encodeURIComponent(name)}`,
  uploadAttachment: (
    taskId: string,
    file: { name: string; contentBase64: string },
  ): Promise<AttachmentUpload> => post(`/api/tasks/${taskId}/attachments`, file),
  deleteAttachment: (taskId: string, name: string): Promise<{ ok: true }> =>
    fetch(`/api/tasks/${taskId}/attachments/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).then(json),
  /** The task's NOTES across sessions. Distinct from the trace: the trace says what HAPPENED (a tool
   *  call, a push, a session end), a note says what the agent meant to SAY when changing status. */
  activity: (taskId: string): Promise<TaskNote[]> =>
    fetch(`/api/tasks/${taskId}/activity`).then(json),
};

export type TaskNote = {
  id: string;
  taskId: string;
  /** `agent` in the vast majority of cases; `human` and `system` exist for wake-ups. */
  from: "agent" | "human" | "system";
  body: string;
  createdAt: number;
};
