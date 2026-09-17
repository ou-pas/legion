// Persists the Linear Issues filters: lazy read on mount, explicit resync on project change,
// conditional write (see `writeFilters`: `removeItem` when no filter is active, otherwise the reset
// does not survive the next render, plan §B3).
import { useEffect, useState } from "react";
import {
  EMPTY_FILTERS,
  isActive,
  readFilters,
  writeFilters,
  type IssueFilters,
} from "./issue-filters.js";

export function useIssueFilters(projectId: string) {
  const [scopeId, setScopeId] = useState(projectId);
  const [filters, setFilters] = useState<IssueFilters>(() => readFilters(projectId));

  // A lazily initialised `useState` does not reset when `projectId` changes (moving from project A
  // to B through the rail): without this catch-up, A's filters would stay displayed, and active,
  // on B's issues. Adjusted during render (the React-documented pattern), not in an effect, to avoid
  // a cascading second render.
  if (projectId !== scopeId) {
    setScopeId(projectId);
    setFilters(readFilters(projectId));
  }

  useEffect(() => {
    writeFilters(projectId, filters);
  }, [projectId, filters]);

  const setDimension = (dim: keyof IssueFilters, value: string) =>
    setFilters((f) => ({ ...f, [dim]: value ? [value] : [] }));

  const reset = () => setFilters(EMPTY_FILTERS);

  return { filters, setDimension, reset, active: isActive(filters) };
}
