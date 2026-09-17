// A session's artifacts folder, and the ones it may read.
//
// The bug, seen on `tCgO0ORtqe` (26/08): its description says in so many words "full contract to
// resume on the web side in /artifacts/Sx-ZVdJP3r/implementation.md". Its session got two folders,
// `/agents/plan` and `/artifacts/tCgO0ORtqe`, so it was sent to read a file it could not open and
// worked without the contract that motivated it.
//
// The data was not missing. Lineage has been in the database since batch 45 (`proposedFromTaskId`)
// and on screen since 25/08 (`task-links.ts`): the application knows one task comes from another,
// shows it, even offers to run it. Only the session could not cross that link. Same as the 23/08
// relative-path bug: the agent is sent somewhere it may not reach.
//
// Why not a "shared" folder cleaned at the end (the operator's first idea, 26/08). We would have
// to decide what goes in, although the link saying who reads what already exists; "the end" does
// not exist for a standalone task whose descendants may be born months later; and above all a
// cleanup would erase the evidence, while the artifacts folder is exactly what a human reopens to
// review. So nothing is copied: reading is opened on the family, and there is nothing to clean.
// Artifact retention is a real topic, but it belongs to task archiving, not sharing.
//
// The family, and its bounds. Four explicit links, all in the database: the origin
// (`proposedFromTaskId`), the blockers (`task_blockers`), the awaited task (`inbox.waitForTaskId`)
// and the tasks filed during this session. Siblings meet in two steps (up to the origin, back
// down), so no special case. Writing: never. A child reads its origin's contract, it does not
// rewrite it, or the review trace would become a many-handed document without history. Project
// boundary: hard, tested. Two bounds against explosion, because this path runs on every fs call:
// four steps deep, twelve folders.
import type { FsGrant } from "../../projects/fs-acl.js";
import { awaitedTaskIds, tasksByIds, tasksByParentIds, type Kin } from "./scope-store.js";
import { blockersByTask } from "../blockers.js";
import { taskRunScope } from "../lifecycle.js";

/** A task's artifacts folder: its run scope, not its id. A chain step and a goal round share their
 *  run's folder; `taskRunScope` decides. */
export function artifactsPath(task: {
  id: string;
  templateRunId: string | null;
  goalId?: string | null;
}): string {
  return `/artifacts/${taskRunScope(task)}`;
}

/** Walk depth. Four steps cover the longest real case seen: a plan files an implementation, which
 *  files a relay, which files a fix. Beyond that, lineage means nothing to the reading agent. */
const MAX_DEPTH = 4;
/** Number of linked folders granted. A bound, not a setting: a brief announcing thirty folders
 *  informs nobody, and a model reads the list every session. */
export const LINKED_SCOPE_CAP = 12;

/** One walk step: the direct neighbours of `rows`, in the same project, never already seen. */
function step(rows: Kin[], projectId: string, visited: Set<string>): Kin[] {
  const up = new Set<string>();
  for (const r of rows) if (r.proposedFromTaskId) up.add(r.proposedFromTaskId);
  // Blockers come from the table, in one query for the whole step (v44).
  for (const refs of blockersByTask(rows.map((r) => r.id)).values())
    for (const b of refs) up.add(b.id);
  for (const id of awaitedTaskIds(rows.map((r) => r.id))) up.add(id);
  const ancestors = tasksByIds([...up], projectId);
  const children = tasksByParentIds(
    rows.map((r) => r.id),
    projectId,
  );
  const out: Kin[] = [];
  for (const r of [...ancestors, ...children]) {
    if (visited.has(r.id)) continue;
    visited.add(r.id);
    out.push(r);
  }
  return out;
}

/** The artifact scopes this task may read, its own excluded, nearest first. A scope appears once:
 *  the six steps of a chain share theirs. */
export function linkedArtifactScopes(task: Kin): string[] {
  const scopes = new Set<string>([taskRunScope(task)]);
  const visited = new Set<string>([task.id]);
  const out: string[] = [];
  let frontier: Kin[] = [task];
  for (let depth = 0; depth < MAX_DEPTH && out.length < LINKED_SCOPE_CAP; depth++) {
    frontier = step(frontier, task.projectId, visited);
    if (frontier.length === 0) break;
    for (const r of frontier) {
      const scope = taskRunScope(r);
      if (scopes.has(scope)) continue;
      scopes.add(scope);
      out.push(scope);
      if (out.length >= LINKED_SCOPE_CAP) break;
    }
  }
  return out;
}

/** A session's artifacts folders: its own writable, its family's read-only.
 *
 *  One definition, called by the two places that must agree: the fs route that authorises and the
 *  brief that announces. Apart, they diverge, and an agent is told about a folder it is refused (or
 *  worse, the reverse). */
export function sessionArtifactGrants(task: Kin): FsGrant[] {
  return [
    { folderPath: artifactsPath(task), canRead: true, canWrite: true, canDelete: false },
    ...linkedArtifactScopes(task).map((scope) => ({
      folderPath: `/artifacts/${scope}`,
      canRead: true,
      canWrite: false,
      canDelete: false,
    })),
  ];
}
