// Business rules for an agent's tools: ranking (grant level) and draft composition. This module
// never rejudges the server allowlist (validateAllowedTools, server/src/capabilities/tool-grants.ts):
// server revalidation is enough, and duplicating it would be two truths for a guarantee the 400
// already gives.
//
// Nor does it copy it: the catalogue comes from `GET /api/tool-catalog` and passes through these
// functions as a parameter. A static mirror fails silently: the day the server accepted two more
// tools, the screen could not tick them and filed them as leftovers.
import type { ToolCatalog } from "../api/capabilities.js";
import type { PermissionLevel } from "../ui/permission-list.js";
import { same } from "./draft.js";

const READ_ONLY = new Set<string>([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "mcp__legion__fs_list",
  "mcp__legion__fs_read",
]);

/** The level shown next to a ticked tool. An external `mcp__<server>` is ranked `rw` by default:
 *  its real power is unknown to the app (it belongs to the third-party MCP server), so assume the
 *  maximum, never the minimum; lying downwards would be the security risk. The two web tools read,
 *  they do not write: ranked `r`. */
export function toolLevel(tool: string): PermissionLevel {
  return READ_ONLY.has(tool) ? "r" : "rw";
}

/** Everything the server catalogue can name, in the order the screen offers them. */
export const catalogTools = (catalog: ToolCatalog): string[] => [
  ...catalog.baseSdkTools,
  ...catalog.legionMcpTools,
];

/** The effective tool set shown; `null` = default set. */
export const effectiveTools = (allowedTools: string[] | null, catalog: ToolCatalog): string[] =>
  allowedTools ?? catalog.defaultTools;

/** An array equal (up to order) to the default set is not a customisation: it becomes `null`.
 *  Unticking then reticking everything returns to default with no special gesture, and `isDirty`
 *  turns off on its own. */
export function normalizeTools(next: string[], catalog: ToolCatalog): string[] | null {
  return same(next, catalog.defaultTools) ? null : next;
}

/** Toggles a tool in the draft. Defence in depth: refuses to remove a required inbox tool while
 *  `inboxAccess` is on. The screen already locks the box (see permissions.tsx) and the server
 *  already answers 400, but the rule lives here, where it is known. */
export function toggleTool(
  allowedTools: string[] | null,
  tool: string,
  opts: { inboxAccess: boolean; catalog: ToolCatalog },
): string[] | null {
  if (opts.inboxAccess && opts.catalog.requiredInboxTools.includes(tool)) return allowedTools;
  const current = effectiveTools(allowedTools, opts.catalog);
  const next = current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool];
  return normalizeTools(next, opts.catalog);
}

/** Unticking an MCP server must remove its tools from the draft in the same gesture, otherwise the
 *  next save answers 400 for an orphaned array on a screen where the operator touched neither the
 *  box nor the Tools tab. Never touches mcp__legion__* (never tied to a project grant, see
 *  server/src/capabilities/tool-grants.ts). `null` passes through unchanged. */
export function pruneToolsForServers(
  allowedTools: string[] | null,
  grantedServerNames: string[],
  catalog: ToolCatalog,
): string[] | null {
  if (allowedTools === null) return null;
  const next = allowedTools.filter((t) => {
    if (!t.startsWith("mcp__") || t.startsWith("mcp__legion__")) return true;
    const rest = t.slice("mcp__".length);
    return grantedServerNames.some((server) => rest === server || rest.startsWith(`${server}__`));
  });
  return normalizeTools(next, catalog);
}

/** A name neither the server catalogue nor a granted server explains: inherited, server deleted
 *  since, or server catalogue moved (D1). Used to render the "outside allowlist" catch-up row rather
 *  than leave a stale entry invisible and blocking. */
export function isKnownTool(
  tool: string,
  grantedServerNames: string[],
  catalog: ToolCatalog,
): boolean {
  if (catalogTools(catalog).includes(tool)) return true;
  if (!tool.startsWith("mcp__")) return false;
  const rest = tool.slice("mcp__".length);
  return grantedServerNames.some((server) => rest === server || rest.startsWith(`${server}__`));
}
