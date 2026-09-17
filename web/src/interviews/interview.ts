// What an interview is: the rule, not its rendering.
//
// Discussion mode (`/artifacts/rtQLldYSm2/spec.md`) added nothing to the model: an interview is a
// task assigned to the built-in `interviewer` agent, run like any other (`POST /api/tasks` +
// `POST /api/tasks/:id/run`). There is no route of its own, so this module only names the
// convention in one place: recognising an interview task, finding the agent that runs it, counting
// rounds.
//
// Rounds are derived from the thread, not from a stored counter: a round is a question put to the
// human, and `channels/transcript.ts` already yields one segment per question. No ceiling (D12):
// the server imposes none, and showing one would invent a limit nothing enforces. The guardrail is
// the per-session token budget.
import type { Agent } from "../api/agents.js";
import type { TaskSummary } from "../api/tasks.js";
import type { Segment } from "../channels/transcript.js";

/** The built-in agent's name as written in the server catalogue (`server/src/chains/catalog.ts`,
 *  BUILTIN_AGENTS). It is the only recognition key: an agent has no "type", it has a name, and
 *  installing copies this one. */
export const INTERVIEWER_AGENT_NAME = "interviewer";

/** The library entry to instantiate when the project has no interviewer yet
 *  (`POST /api/agent-templates/:id/instantiate`). `builtin:` means it lives in server code, not in
 *  the database. */
export const INTERVIEWER_TEMPLATE_ID = `builtin:${INTERVIEWER_AGENT_NAME}`;

export function findInterviewer(agents: Agent[], projectId: string | undefined): Agent | undefined {
  return agents.find((a) => a.projectId === projectId && a.name === INTERVIEWER_AGENT_NAME);
}

/** An interview task: one run by the interviewer. `assignee` is the agent already resolved by the
 *  screen; no need to refetch the agent list for a name comparison. */
export function isInterviewTask(
  task: TaskSummary | undefined,
  assignee: Agent | undefined,
): boolean {
  return Boolean(
    task &&
    assignee &&
    task.assigneeAgentId === assignee.id &&
    assignee.name === INTERVIEWER_AGENT_NAME,
  );
}

/** Rounds held: questions asked, answered ones included. No ceiling. */
export function countRounds(segments: Segment[]): number {
  return segments.filter((s) => s.kind === "round").length;
}
