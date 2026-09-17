// Promote an agent to a template (v11): copy its card into the library to reuse elsewhere.
//
// The card is copied, not the grants. Role, model, tools, repository and inbox access travel;
// granted repositories, secrets, rules and MCP servers do not: they point at rows of one project,
// and a template belongs to none (which is also why `installAgent` starts with no grant).
//
// Upsert by name: two templates with the same name would be indistinguishable on screen.
import { nanoid } from "nanoid";
import {
  allAgentTemplates,
  getAgent,
  insertAgentTemplate,
  updateAgentTemplate,
} from "./promote-store.js";

export type PromoteResult =
  | { ok: true; id: string; updated: boolean }
  | { ok: false; status: 404; error: string };

export function promoteAgentToTemplate(agentId: string): PromoteResult {
  const agent = getAgent(agentId);
  if (!agent) return { ok: false, status: 404, error: "agent not found" };

  const values = {
    name: agent.name,
    title: agent.title,
    model: agent.model,
    rolePrompt: agent.rolePrompt,
    allowedTools: agent.allowedTools,
    repoAccess: agent.repoAccess,
    inboxAccess: agent.inboxAccess,
  };

  const existing = allAgentTemplates().find((t) => t.name === agent.name);
  if (existing) {
    updateAgentTemplate(existing.id, values);
    return { ok: true, id: existing.id, updated: true };
  }

  const id = nanoid(10);
  insertAgentTemplate({ id, ...values, createdAt: new Date() });
  return { ok: true, id, updated: false };
}
