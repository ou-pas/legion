// Cascading deletes: a project or a task, with all its descendants (there was no way to delete
// either before 20/08).
//
// Delete order matters: foreign keys are on for the server connection, and two edges cross:
//   tasks.assignee_agent_id → agents        (tasks before agents)
//   agents.environment_id   → environments  (agents before environments)
// A wrong order leaves no orphan, it throws and rolls back, but do not rely on that. The order lives
// in `purge-store.ts`.
import { consumeBlockersOf, releaseDependentsOf } from "../tasks/blockers.js";
import { releaseSessionVolumes } from "../sessions/runner/volumes.js";
import { releaseWorkspace } from "../sessions/runner/workspace.js";
import { ACTIVE_STATUSES } from "../sessions/session-terminal.js";
import {
  agentRowById,
  countActivityOfTask,
  countAgentsOfProject,
  countEnvironmentsOfProject,
  countGoalsOfProject,
  countInboxOfTask,
  countInboxOfTasks,
  countMcpServersOfProject,
  countReposOfProject,
  countRulesOfProject,
  countSecretsOfProject,
  countSessionEventsOfSessions,
  countTemplatesOfProject,
  deleteProjectCascade,
  deleteTaskCascade,
  goalIdsOfProject,
  projectRowById,
  sessionIdsOfTask,
  sessionIdsOfTasks,
  sessionRowsForAgentInStatuses,
  sessionRowsForTaskInStatuses,
  sessionRowsForTasksInStatuses,
  taskIdsOfProject,
  taskNamesByIds,
  taskRowById,
} from "./purge-store.js";

/** States in which a session still works. A project with one is not deleted: the container would
 *  lose its callback target mid-run. Exported for `task-serialize.ts`, to compute `editable` over a
 *  batch of tasks.
 *
 *  It used to be a copy of `ACTIVE_STATUSES`, and a copied status list drifts unnoticed: `blocked`
 *  (slice nav/11) missing here would have let a project be purged while a session awaited a
 *  decision. */
export const LIVE = ACTIVE_STATUSES;

export interface ProjectFootprint {
  tasks: number;
  sessions: number;
  agents: number;
  goals: number;
  repos: number;
  rules: number;
  mcpServers: number;
  secrets: number;
  environments: number;
  templates: number;
  inbox: number;
}

/** What a delete would destroy, announced before doing it: "delete this project" and "delete 23
 *  tasks and 23 sessions" are not decided the same way. */
export function projectFootprint(projectId: string): ProjectFootprint {
  const taskIds = taskIdsOfProject(projectId);
  return {
    tasks: taskIds.length,
    sessions: sessionIdsOfTasks(taskIds).length,
    inbox: countInboxOfTasks(taskIds),
    agents: countAgentsOfProject(projectId),
    goals: countGoalsOfProject(projectId),
    repos: countReposOfProject(projectId),
    rules: countRulesOfProject(projectId),
    mcpServers: countMcpServersOfProject(projectId),
    secrets: countSecretsOfProject(projectId),
    environments: countEnvironmentsOfProject(projectId),
    templates: countTemplatesOfProject(projectId),
  };
}

/** Live sessions in this project; empty means deletable.
 *
 *  A demo project never has any, whatever `status` says: its sessions are seeded data frozen in
 *  realistic states (`waiting`, `running`), and the runner refuses to start anything there. Without
 *  this exception the demo project was undeletable, three mock sessions protecting it forever (seen
 *  on the operator's real database, 20/08). */
export function liveSessions(
  projectId: string,
): { id: string; status: string; taskName: string }[] {
  const project = projectRowById(projectId);
  if (project?.demo) return [];
  const taskIds = taskIdsOfProject(projectId);
  if (taskIds.length === 0) return [];
  const rows = sessionRowsForTasksInStatuses(taskIds, LIVE);
  const names = taskNamesByIds(taskIds);
  return rows.map((s) => ({ id: s.id, status: s.status, taskName: names.get(s.taskId) ?? "?" }));
}

/** One transaction: a half-cleaned database would be worse than nothing. */
export function deleteProject(projectId: string): ProjectFootprint {
  const footprint = projectFootprint(projectId);
  const taskIds = taskIdsOfProject(projectId);
  const sessionIds = sessionIdsOfTasks(taskIds);
  const goalIds = goalIdsOfProject(projectId);

  // Same as deleting a task: once the rows are gone nothing links a workspace folder to a project
  // (D13). v52: remote runner volumes too, read before the transaction (see volumes.ts).
  void releaseSessionVolumes(sessionIds);
  for (const id of sessionIds) releaseWorkspace(id);
  deleteProjectCascade({ projectId, taskIds, sessionIds, goalIds });
  return footprint;
}

/** What deleting the project would destroy and what prevents it, asked by the UI before showing the
 *  confirmation. `null` means the project does not exist. */
export function projectPurgePreview(
  projectId: string,
): { footprint: ProjectFootprint; live: ReturnType<typeof liveSessions> } | null {
  if (!projectRowById(projectId)) return null;
  return { footprint: projectFootprint(projectId), live: liveSessions(projectId) };
}

export type ProjectPurged =
  | { ok: true; deleted: string; footprint: ProjectFootprint }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; error: string; live: ReturnType<typeof liveSessions> };

/** Delete with its refusal (06/09). The guard used to live in the handler, beside the function it
 *  protects rather than in front of it, so another caller could delete a project with a running
 *  session. The offending sessions are named, which makes the refusal fixable. */
export function purgeProject(projectId: string): ProjectPurged {
  const project = projectRowById(projectId);
  if (!project) return { ok: false, status: 404, error: "project not found" };
  const live = liveSessions(project.id);
  if (live.length > 0)
    return {
      ok: false,
      status: 409,
      error: `${live.length} session(s) in flight in this project — stop them first`,
      live,
    };
  return { ok: true, deleted: project.name, footprint: deleteProject(project.id) };
}

// Tasks: likewise nothing allowed deleting a task (archiving is only offered for `done`).

export interface TaskFootprint {
  sessions: number;
  events: number;
  inbox: number;
  activity: number;
}

/** Live sessions on this task; empty means deletable. */
export function taskLiveSessions(taskId: string): { id: string; status: string }[] {
  const task = taskRowById(taskId);
  if (!task) return [];
  const project = projectRowById(task.projectId);
  if (project?.demo) return []; // seeded sessions, nothing runs (see liveSessions)
  return sessionRowsForTaskInStatuses(taskId, LIVE).map((s) => ({ id: s.id, status: s.status }));
}

/** Live sessions of this agent across projects (`sessions.agent_id` points at the agent directly).
 *  Used by `agent-role-edit.ts`: the role sent to a session already started is not rewritten
 *  afterwards (same principle as `taskLiveSessions` for the brief). */
export function agentLiveSessions(agentId: string): { id: string; status: string }[] {
  const agent = agentRowById(agentId);
  if (!agent) return [];
  const project = projectRowById(agent.projectId);
  if (project?.demo) return []; // seeded sessions, nothing runs (see liveSessions)
  return sessionRowsForAgentInStatuses(agentId, LIVE).map((s) => ({ id: s.id, status: s.status }));
}

/** Deletes a task and its descendants in one transaction.
 *
 *  Blocking links are neutralised rather than followed: a task blocking others (`task_blockers`)
 *  releases them, or the next step of a chain would stay blocked forever by a vanished task. If it
 *  was their last blocker they are released inside the delete transaction (behaviour 8). */
export function deleteTask(taskId: string): TaskFootprint {
  const sessionIds = sessionIdsOfTask(taskId);
  const footprint: TaskFootprint = {
    sessions: sessionIds.length,
    events: countSessionEventsOfSessions(sessionIds),
    inbox: countInboxOfTask(taskId),
    activity: countActivityOfTask(taskId),
  };
  // D13: `/workspace` folders go before the transaction, while session ids are still readable.
  // Afterwards nothing links the folder to anything until the next boot's sweep. v52: remote runner
  // volumes too, read before the transaction (see volumes.ts).
  void releaseSessionVolumes(sessionIds);
  for (const id of sessionIds) releaseWorkspace(id);
  // Release dependents before disappearing: a step blocked by a missing task would never start.
  // Releasing is consuming the link, inside the transaction; no launch from a delete (as before v44),
  // the scheduler tick drains the queue within 30 s. The FK cascade would do the same cleanup on
  // `delete`; writing it keeps the order readable.
  deleteTaskCascade(taskId, sessionIds, () => {
    releaseDependentsOf(taskId);
    consumeBlockersOf(taskId);
  });
  return footprint;
}
