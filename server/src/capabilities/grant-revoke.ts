// Remove a capability from every agent holding it (06/09).
//
//  · Scope: a rule or an MCP server belongs to one project, so the sweep stays within it. A skill
//    is global (on disk, not in the database) and sweeps every agent.
//  · Atomicity: one transaction for N updates. better-sqlite3 is synchronous, but an exception
//    midway would otherwise leave half the grants removed.
//
// A ghost grant is not harmless: it goes into the session spec, and the runtime fails trying to
// mount a folder that no longer exists.
import type * as schema from "../../drizzle/schema.js";
import {
  agentsOfProject,
  allAgents,
  mcpServerProjectId,
  ruleProjectId,
  updateAgentFields,
  withTransaction,
} from "./grant-revoke-store.js";

type AgentRow = typeof schema.agents.$inferSelect;

/** The three capabilities granted by id on an agent's card. */
export type GrantKind = "skill" | "rule" | "mcpServer";

/** Reads and writes the right column without a cast: a computed key in a Drizzle `set()` would
 *  lose the column type. */
const COLUMN: Record<
  GrantKind,
  { read: (a: AgentRow) => string; write: (v: string) => Partial<AgentRow> }
> = {
  skill: { read: (a) => a.skillNames, write: (v) => ({ skillNames: v }) },
  rule: { read: (a) => a.ruleIds, write: (v) => ({ ruleIds: v }) },
  mcpServer: { read: (a) => a.mcpServerIds, write: (v) => ({ mcpServerIds: v }) },
};

/** The capability's owning project, or `null` for a skill or a row already gone. Either way every
 *  agent is swept: the right scope for a skill, the only way to clear grants of a vanished row. */
function ownerProject(kind: GrantKind, id: string): string | null {
  if (kind === "rule") return ruleProjectId(id);
  if (kind === "mcpServer") return mcpServerProjectId(id);
  return null;
}

/**
 * Removes `id` from the grants of every concerned agent in one transaction and returns the number
 * of agents changed. Call before deleting the row: the row tells which project to sweep.
 */
export function revokeGrantEverywhere(kind: GrantKind, id: string): number {
  const { read, write } = COLUMN[kind];
  const projectId = ownerProject(kind, id);
  const agents = projectId === null ? allAgents() : agentsOfProject(projectId);

  return withTransaction(() => {
    let revoked = 0;
    for (const agent of agents) {
      const granted = JSON.parse(read(agent)) as string[];
      if (!granted.includes(id)) continue;
      updateAgentFields(agent.id, write(JSON.stringify(granted.filter((x) => x !== id))));
      revoked += 1;
    }
    return revoked;
  });
}
