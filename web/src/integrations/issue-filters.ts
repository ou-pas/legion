// Linear Issues screen filters (assignee, status, team): a pure module, no React import.
//
// `filterIssues` and `deriveOptions` left on 01/09: both assumed the loaded batch was the
// workspace. Measured: 50 issues out of 250+, 10 visible assignees out of 26 members. Filtering now
// happens at Linear (`api/integrations.ts`) and menus come from the workspace
// (`GET /api/linear/options`). What stays is the filter shape and its persistence.
//
// Decisions (/artifacts/CTnl9zZmW4/plan-filtres-issues-linear.md §1):
// - D2: single selection per dimension in v1, but stored as arrays, so multi-select later is a UI
//   change with no storage migration.
// - D3 (operator, 21/08, against the plan's initial advice): the status filter is on `state` (the
//   displayed Linear label), not `stateType` (the closed 4-value enum). `state` is free text that
//   can differ per team, so options cannot be hardcoded. A saved value can become a "ghost filter"
//   (someone gone, team archived, label renamed); the screen keeps it visible rather than pass it
//   off as "all".
// - D4: localStorage key scoped per project, so one project's filters do not apply to another.
export interface IssueFilters {
  assigneeIds: string[];
  statuses: string[];
  teamIds: string[];
}

export const EMPTY_FILTERS: IssueFilters = { assigneeIds: [], statuses: [], teamIds: [] };
export const STORAGE_VERSION = 1;

export const storageKey = (projectId: string): string => `legion.issuesFilters.${projectId}`;

/** No active filter = the previous screen, no issue hidden. */
export function isActive(f: IssueFilters): boolean {
  return f.assigneeIds.length > 0 || f.statuses.length > 0 || f.teamIds.length > 0;
}

/** The question asked of Linear, taken from the stored filters. D2 stores arrays; v1 only keeps the
 *  first value, which is what the query accepts today. */
export function toQuery(f: IssueFilters): { assigneeId?: string; teamId?: string; state?: string } {
  return { assigneeId: f.assigneeIds[0], teamId: f.teamIds[0], state: f.statuses[0] };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

/** Defensive validation: `JSON.parse` can return anything. Falls back to `EMPTY_FILTERS` on a wrong
 *  version, a non-object, or a key that is not a string array: no blank page on a corrupt value. */
function parse(raw: string): IssueFilters {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== "object" || obj === null) return EMPTY_FILTERS;
  const o = obj as Record<string, unknown>;
  if (o.version !== STORAGE_VERSION) return EMPTY_FILTERS;
  const assigneeIds = isStringArray(o.assigneeIds) ? o.assigneeIds : [];
  const statuses = isStringArray(o.statuses) ? o.statuses : [];
  const teamIds = isStringArray(o.teamIds) ? o.teamIds : [];
  return { assigneeIds, statuses, teamIds };
}

/** Same idiom as ui/theme.tsx: blocked storage (private browsing) or a corrupt value falls back to
 *  "no active filter", never a crashing screen. */
export function readFilters(projectId: string): IssueFilters {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    return raw === null ? EMPTY_FILTERS : parse(raw);
  } catch {
    return EMPTY_FILTERS;
  }
}

/** Writes the entry only if a filter is active, otherwise removes it. That is what makes "Reset"
 *  actually clear the key: the naive "write on every state change" would rewrite it right after. */
export function writeFilters(projectId: string, f: IssueFilters): void {
  try {
    if (isActive(f))
      localStorage.setItem(
        storageKey(projectId),
        JSON.stringify({ version: STORAGE_VERSION, ...f }),
      );
    else localStorage.removeItem(storageKey(projectId));
  } catch {
    /* storage unavailable: the filters stay valid for the session */
  }
}

export function clearFilters(projectId: string): void {
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    /* ignore */
  }
}
