// Starting an interview: the two starting points of D2, nothing else.
//
// There is no interview route: an interview is a task assigned to the interviewer, run like any
// task. This module holds the sequence (install the agent if missing, create the task, run it) in
// one place, because two screens trigger it and a copied sequence diverges.
//
// Creating the task is not a design choice: `sessions.task_id` is NOT NULL (drizzle/schema.ts).
// From the composer there is nothing to attach a session to until a task exists, so one is created
// and it carries the interview. The build task comes later, filed by the agent (`propose_task`),
// with the spec as its brief.
import { agentsApi, type Agent } from "../api/agents.js";
import { tasksApi } from "../api/tasks.js";
import type { PickedAttachment } from "../tasks/attachments.js";
import { findInterviewer, INTERVIEWER_TEMPLATE_ID } from "./interview.js";
import { INTERVIEW_TEXT } from "./text.js";

/** What the run asked of the server, as it happened, so the screen says it instead of assuming.
 *  `queued` carries the reason when `runTask` declined to start right away (capacity full,
 *  preflight): the task exists anyway, it is not a failure. */
export type InterviewStart = { taskId: string; installed: boolean; queued: string | null };

/** The project's interviewer, installed on the way if missing. Installing is a built-in catalogue
 *  gesture (`POST /api/agent-templates/builtin:interviewer/instantiate`): it adds an agent to the
 *  project and touches nothing else. */
async function ensureInterviewer(
  agents: Agent[],
  projectId: string,
): Promise<{ agentId: string; installed: boolean }> {
  const existing = findInterviewer(agents, projectId);
  if (existing) return { agentId: existing.id, installed: false };
  const created = (await agentsApi.instantiateAgentTemplate(
    INTERVIEWER_TEMPLATE_ID,
    projectId,
  )) as { id: string };
  return { agentId: created.id, installed: true };
}

/** Attachments upload before the run, the same rule as `launch` (`tasks/use-task-submit.ts`): a
 *  session's spec names the files present at start. Running first would start an interviewer told
 *  about a screenshot it cannot find, or not told about one arriving a second later.
 *
 *  Until 16/09 this step was missing: `discuss` held the composer's files and passed none on, so an
 *  interview opened on a screenshot left without it, silently. */
async function uploadAll(taskId: string, files: readonly PickedAttachment[]): Promise<void> {
  for (const file of files)
    await tasksApi.uploadAttachment(taskId, {
      name: file.name,
      contentBase64: file.contentBase64,
    });
}

/** A run that does not start right away is not a failed run: the task exists and the server says
 *  why it waits. The reason is returned; the screen picks its tone. */
const runOrQueue = (taskId: string): Promise<string | null> =>
  tasksApi.runTask(taskId).then(
    () => null,
    (e: Error) => e.message,
  );

/** Starting point 1, the composer: nothing exists yet, the interview task is created. */
export async function startInterview(input: {
  agents: Agent[];
  projectId: string;
  subject: string;
  brief: string;
  priority?: "low" | "med" | "high";
  /** What the composer held: a screenshot is worth the brief it replaces, and it is often what the
   *  interview should put to the test. */
  attachments?: readonly PickedAttachment[];
}): Promise<InterviewStart> {
  const { agentId, installed } = await ensureInterviewer(input.agents, input.projectId);
  const task = await tasksApi.createTask({
    name: INTERVIEW_TEXT.start.taskName(input.subject),
    projectId: input.projectId,
    agentId,
    // The thin brief is the interview's subject: what the agent will put to the test.
    ...(input.brief.trim() ? { description: input.brief.trim() } : {}),
    // No gate: the approval door already exists at the end, the filed task lands in "Later",
    // unassigned (D15). Two doors would approve twice.
    approvalGate: false,
    ...(input.priority ? { priority: input.priority } : {}),
  });
  await uploadAll(task.id, input.attachments ?? []);
  return { taskId: task.id, installed, queued: await runOrQueue(task.id) };
}

/** Starting point 2, an existing task too thin: it becomes the interview. Its agent changes; its
 *  name, brief and lineage do not. */
export async function interviewExistingTask(input: {
  agents: Agent[];
  projectId: string;
  taskId: string;
}): Promise<InterviewStart> {
  const { agentId, installed } = await ensureInterviewer(input.agents, input.projectId);
  await tasksApi.updateTask(input.taskId, { agentId });
  return { taskId: input.taskId, installed, queued: await runOrQueue(input.taskId) };
}
