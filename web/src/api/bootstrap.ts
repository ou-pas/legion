import { json } from "./client.js";
import type { Project } from "./projects.js";
import type { Agent } from "./agents.js";
import type { RunnerRow } from "./sessions.js";
import type { Template } from "./chains.js";

export const bootstrapApi = {
  bootstrap: (): Promise<{
    projects: Project[];
    agents: Agent[];
    runners: RunnerRow[];
    templates: Template[];
  }> => fetch("/api/bootstrap").then(json),
};

/** What an id designates (26/08), so ⌘K opens a task when an id is pasted. Next to `bootstrap`
 *  because the question spans four domains. Rejects with 404 when the id does not exist; the
 *  caller treats that as "nothing found", not as a failure. */
export type LookupKind = "task" | "goal" | "agent" | "project";
export interface LookupHit {
  kind: LookupKind;
  id: string;
  label: string;
  projectId: string | null;
}

export const lookupApi = {
  lookup: (id: string): Promise<LookupHit> =>
    fetch(`/api/lookup/${encodeURIComponent(id)}`).then(json),
};
