// Open an id from ⌘K (26/08, operator's request): an id seen in a commit, a message or a copied URL
// should lead to its page instead of "no matching command".
//
// Here, not in a domain: the question crosses tasks, goals, agents and projects (CLAUDE.md:
// several domains, so the assembler). Resolved server-side because `bootstrap` does not carry
// tasks: loading hundreds of them to find one by id would pay a whole list for one row.
import { agentRow, goalRow, projectRow, taskRow } from "./http-store.js";

export type LookupKind = "task" | "goal" | "agent" | "project";

export interface LookupHit {
  kind: LookupKind;
  id: string;
  /** Nobody remembers a nanoid: the label lets the operator recognise the target. */
  label: string;
  /** Null for a project itself. */
  projectId: string | null;
}

/** Product ids are `nanoid(10)`, but we accept wider: a pasted id may be truncated, and too strict a
 *  refusal reads as "broken" rather than "not an id". */
const ID_SHAPE = /^[A-Za-z0-9_-]{6,24}$/;

/**
 * Accepts a bare id AND an app URL: the clipboard usually holds the whole URL from the address bar.
 * Pure: it decides whether a keystroke deserves a server round trip.
 */
export function idCandidate(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  // Last non-empty segment: `/p/<id>/channels/<taskId>` gives the taskId, the page being viewed.
  const last = raw.includes("/")
    ? (raw.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "")
    : raw;
  return ID_SHAPE.test(last) ? last : null;
}

/** One round trip, four tables. */
export function lookupId(id: string): LookupHit | null {
  const task = taskRow(id);
  if (task) return { kind: "task", id: task.id, label: task.name, projectId: task.projectId };

  const goal = goalRow(id);
  if (goal) return { kind: "goal", id: goal.id, label: goal.name, projectId: goal.projectId };

  const agent = agentRow(id);
  if (agent) return { kind: "agent", id: agent.id, label: agent.name, projectId: agent.projectId };

  const project = projectRow(id);
  if (project) return { kind: "project", id: project.id, label: project.name, projectId: null };

  return null;
}
