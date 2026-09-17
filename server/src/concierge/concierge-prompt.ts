// Puts the compiled context (concierge-context.ts) and the ongoing exchange into words — PURE: no
// clock, no network, no database. That is what makes this file testable without the SDK or a DB.
import type { ConciergeContextData } from "./concierge-context.js";
import { CHAT_ROLE } from "./chat-enums.js";
import type { ChatRole } from "./chat-enums.js";

export interface ConciergeTurn {
  role: ChatRole;
  content: string;
}

export interface ConciergeInput {
  message: string;
  history: ConciergeTurn[];
}

/** Tells the model what the server already enforces by construction (`tools: []`, three named MCP
 *  tools, a `canUseTool` that refuses everything else — see concierge.ts). This is NOT the
 *  security mechanism: a model that "believes" it can write would still fail. It is an
 *  explanation, so that the answer never claims to have acted.
 *
 *  REWRITTEN ON 13/09. It announced "you were given no tool" and "I can only inform, not act",
 *  and the concierge served that sentence word for word to the only real question it was ever
 *  asked. It was accurate; what changed is the design it described.
 *
 *  NO LANGUAGE INSTRUCTION (16/09). It used to say "answer in French"; the concierge now answers
 *  in the language the operator writes in. */
export const CONCIERGE_SYSTEM_PROMPT =
  "You are the Legion concierge, the operator's assistant on their own control plane. You " +
  "answer, in short Markdown, questions about what is running, what is blocked and what it " +
  "costs. " +
  // The compiled context is a SUMMARY, and that is the trap the tool-less version fell into: it
  // said "three sessions failed", the model concluded it did not know why, and stopped there. The
  // instruction therefore names the expected move.
  "The context below is only a SUMMARY. As soon as a question is about a specific object — a " +
  "task that is named, linked or described — fetch the detail with your tools instead of " +
  "answering from the summary: `task_detail` for the full state of a task and its sessions, " +
  "`task_timeline` for the execution trace that says WHY a session failed, " +
  "`search_tasks` to find a task that is described rather than named. " +
  // Pasting a URL is the operator's most natural move, and the tool-less version answered "I
  // cannot access the URL": true, and useless — the id was in it.
  "If you are given a task URL, you cannot open it, but the id is written in it: it follows " +
  "/tasks/ (or /taches/ in an older link), so /tasks/AWCsGxmP7i/ gives AWCsGxmP7i. Use it with " +
  "your tools. " +
  "Your tools are READ-ONLY: you cannot modify any task, any session, any setting. If you are " +
  "asked to act, say what you would do and where to do it, without claiming to have done it. If " +
  "neither the context nor your tools hold the answer, say so rather than inventing one. " +
  // NO EMOJI, and it is not a matter of taste: the answer is RENDERED IN THE INTERFACE, whose
  // design contract forbids emoji as icons (docs/DESIGN.md, rule 8). Spotted on 30/08 in a real
  // answer, which titled its sections with 🔄, 📊 and 📭.
  "Never write emoji or pictograms: your answers are displayed in an interface that uses none.";

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/** The id is written in clear (`task=tk42`) because the situation report must be able to CITE a
 *  task, and the screen turns it into a link. That does not give the model the right to make up
 *  an address: it can only copy an id from this list, and `parseBrief` drops anything that is not
 *  in it (concierge-brief.ts). */
function formatTasks(tasks: ConciergeContextData["tasks"]): string {
  if (tasks.length === 0) return "(no task)";
  return tasks
    .map(
      (t) =>
        `- task=${t.id} [${t.projectName}] ${t.name} — ${t.status}, updated ${formatTimestamp(t.updatedAt)}`,
    )
    .join("\n");
}

function formatSessions(sessions: ConciergeContextData["sessions"]): string {
  if (sessions.length === 0) return "(no recent session)";
  return sessions
    .map((s) => {
      const cost = s.costUsd != null ? `$${s.costUsd.toFixed(2)}` : "unknown cost";
      const end = s.endedAt ? `ended ${formatTimestamp(s.endedAt)}` : "running";
      return `- ${s.taskName} (${s.agentName}, ${s.model}) — ${s.status}, ${cost}, started ${formatTimestamp(s.startedAt)}, ${end}`;
    })
    .join("\n");
}

function formatCost(cost: ConciergeContextData["cost"]): string {
  return `$${cost.totalUsd.toFixed(2)} over the last ${cost.windowDays} days, ${cost.runningCount} session(s) running in that window.`;
}

function formatQuestions(questions: ConciergeContextData["pendingQuestions"]): string {
  if (questions.length === 0) return "(no pending question)";
  return questions
    .map(
      (q) => `- task=${q.taskId} [${q.taskName}] ${q.body} (asked ${formatTimestamp(q.createdAt)})`,
    )
    .join("\n");
}

export function formatConciergeContext(data: ConciergeContextData): string {
  return (
    `Context compiled at ${formatTimestamp(data.generatedAt)}:\n\n` +
    `## Recent tasks\n${formatTasks(data.tasks)}\n\n` +
    `## Recent sessions\n${formatSessions(data.sessions)}\n\n` +
    `## Costs\n${formatCost(data.cost)}\n\n` +
    `## Pending questions (inbox)\n${formatQuestions(data.pendingQuestions)}`
  );
}

function formatHistory(history: ConciergeTurn[]): string {
  if (history.length === 0) return "(no previous exchange)";
  return history
    .map((h) => `${h.role === CHAT_ROLE.user ? "Operator" : "Concierge"}: ${h.content}`)
    .join("\n");
}

/** One ephemeral session per call: the history is REPLAYED in the prompt, since the SDK keeps no
 *  memory. What changed in slice nav/10 is WHERE it comes from — the client used to send it on
 *  every call, it is now read back from `concierge_turns` (see `readHistory`). This file does not
 *  notice, and that is the sign the seam is in the right place. */
export function buildConciergePrompt(input: ConciergeInput, context: ConciergeContextData): string {
  return (
    `${formatConciergeContext(context)}\n\n` +
    `## Previous exchange\n${formatHistory(input.history)}\n\n` +
    `## Operator's question\n${input.message}`
  );
}
