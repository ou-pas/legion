// A project's MCP servers (06/09): create, "all agents" checkbox, delete, and the view the screen
// may read.
//
// An MCP server is a capability, not an access: it adds tools and opens no project data by
// itself. That is what allows a project default (`allAgents`) here and forbids one for a secret
// or a repository. Resolution is additive: the agent inherits the default and can tick more.
import { nanoid } from "nanoid";
import type * as schema from "../../drizzle/schema.js";
import { revokeGrantEverywhere } from "./grant-revoke.js";
import {
  deleteMcpServerRow,
  getMcpServer,
  insertMcpServer,
  mcpServersOf,
  setMcpServerAllAgentsField,
} from "./mcp-edit-store.js";
import type { McpServerInput } from "./schemas.js";

type McpServerRow = typeof schema.mcpServers.$inferSelect;

export type McpServerCreateResult =
  | { ok: true; server: Omit<McpServerRow, "config"> }
  | { ok: false; status: 400 | 409; error: string };

/** What the screen sees of a server: its shape, never its content. The config may hold
 *  `${SECRET:X}` (never resolved here) but also plain values, and a URL's query string is hidden:
 *  a token pasted there must not go back to the UI (review 5b). */
export type McpServerView = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  url: string | null;
  command: string | null;
  allowedHosts: string[];
  allAgents: boolean;
  createdAt: Date;
};

function viewOf(row: McpServerRow): McpServerView {
  const cfg = JSON.parse(row.config) as Record<string, unknown>;
  const url = typeof cfg.url === "string" ? cfg.url : null;
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: (cfg.type as string) ?? "stdio",
    url: url === null ? null : (url.split("?")[0] ?? url),
    command: typeof cfg.command === "string" ? cfg.command : null,
    allowedHosts: JSON.parse(row.allowedHosts) as string[],
    allAgents: row.allAgents,
    createdAt: row.createdAt,
  };
}

export function listMcpServers(projectId: string | undefined): McpServerView[] {
  return mcpServersOf(projectId).map(viewOf);
}

/** What the transport requires and the schema does not say: a URL for http/sse, a command for
 *  stdio. Returned as a named refusal so the screen need not guess which field is missing. */
function invalidConfig(config: Record<string, unknown>): string | null {
  const type = config.type ?? "stdio";
  if (type === "http" || type === "sse") {
    if (typeof config.url !== "string") return "config.url required for http/sse";
    try {
      new URL(config.url);
    } catch {
      return "invalid config.url";
    }
    return null;
  }
  if (typeof config.command !== "string" || !config.command.trim())
    return "config.command required for stdio";
  return null;
}

export function createMcpServer(input: McpServerInput): McpServerCreateResult {
  // Two servers with the same name would silently overwrite each other in the session spec
  // (review 5b #7).
  const dup = mcpServersOf(input.projectId).some((r) => r.name === input.name);
  if (dup)
    return {
      ok: false,
      status: 409,
      error: `a server “${input.name}” already exists in this project`,
    };

  const bad = invalidConfig(input.config);
  if (bad) return { ok: false, status: 400, error: bad };

  const row = {
    id: nanoid(10),
    projectId: input.projectId,
    name: input.name,
    config: JSON.stringify(input.config),
    allowedHosts: JSON.stringify(input.allowedHosts ?? []),
    allAgents: input.allAgents === true,
    createdAt: new Date(),
  };
  insertMcpServer(row);
  const { config: _config, ...withoutConfig } = row;
  return { ok: true, server: withoutConfig };
}

export function setMcpServerAllAgents(
  id: string,
  allAgents: boolean,
): { ok: true } | { ok: false; status: 404; error: string } {
  const row = getMcpServer(id);
  if (!row) return { ok: false, status: 404, error: "server not found" };
  setMcpServerAllAgentsField(row.id, allAgents);
  return { ok: true };
}

/** Clears the server's grants, then deletes it: the row tells which project to sweep. */
export function deleteMcpServer(id: string): void {
  revokeGrantEverywhere("mcpServer", id);
  deleteMcpServerRow(id);
}
