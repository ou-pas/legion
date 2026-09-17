// Validation of an agent's role (`agents.rolePrompt`).
//
// A session's system prompt is composed at launch (base + grants + rules + "## Role" +
// rolePrompt, `sessions/runner/brief.ts`), so a running session already has its version.
// Rewriting the role then would make the screen lie about what the session received: 409 while a
// session of this agent is live, as for a task brief (task-edit.ts).
//
// This module validates and does not write (05/09): it used to write first, so
// `{ rolePrompt, effort: "bogus" }` persisted the role before answering 400. The caller now
// writes it in the same update as the rest of the patch. No need to recheck the session guard at
// write time: better-sqlite3 is synchronous and nothing runs between this read and the update.
import { getAgent } from "./role-edit-store.js";
import { agentLiveSessions } from "../../projects/purge.js";

export type AgentRoleEditResult =
  | { ok: true; rolePrompt: string }
  | { ok: false; status: 400 | 404 | 409; error: string; live?: { id: string; status: string }[] };

export const ROLE_PROMPT_MAX = 20_000;

export function validateAgentRoleEdit(agentId: string, rolePrompt: string): AgentRoleEditResult {
  if (typeof rolePrompt !== "string")
    return { ok: false, status: 400, error: "rolePrompt must be text" };

  const agent = getAgent(agentId);
  if (!agent) return { ok: false, status: 404, error: "agent not found" };

  const trimmed = rolePrompt.trim();
  if (!trimmed) return { ok: false, status: 400, error: "empty role" };
  if (trimmed.length > ROLE_PROMPT_MAX)
    return {
      ok: false,
      status: 400,
      error: `role too long (${trimmed.length} characters, maximum ${ROLE_PROMPT_MAX})`,
    };

  const live = agentLiveSessions(agentId);
  if (live.length > 0)
    return {
      ok: false,
      status: 409,
      error: `session ${live[0]!.status} in flight: its role has already gone out, it does not get rewritten afterwards`,
      live,
    };

  return { ok: true, rolePrompt: trimmed };
}
