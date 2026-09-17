// The lineage walk (origin, children, awaited tasks) each `linkedArtifactScopes` step re-reads.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export type Kin = {
  id: string;
  projectId: string;
  templateRunId: string | null;
  goalId: string | null;
  proposedFromTaskId: string | null;
};

const KIN_COLUMNS = {
  id: schema.tasks.id,
  projectId: schema.tasks.projectId,
  templateRunId: schema.tasks.templateRunId,
  goalId: schema.tasks.goalId,
  proposedFromTaskId: schema.tasks.proposedFromTaskId,
};

/** Tasks these tasks waited for (`wait_for_task`, v26). */
export function awaitedTaskIds(taskIds: string[]): string[] {
  if (taskIds.length === 0) return [];
  return db
    .select({ id: schema.inboxMessages.waitForTaskId })
    .from(schema.inboxMessages)
    .where(inArray(schema.inboxMessages.taskId, taskIds))
    .all()
    .map((r) => r.id)
    .filter((id): id is string => Boolean(id));
}

/** The project's tasks whose id is in `ids`: the ancestors a walk step targets. `inArray` on an
 *  empty list produces invalid SQL, so the question is only asked when `ids` has one. */
export function tasksByIds(ids: string[], projectId: string): Kin[] {
  if (ids.length === 0) return [];
  return db
    .select(KIN_COLUMNS)
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), inArray(schema.tasks.id, ids)))
    .all();
}

/** The project's tasks whose origin (`proposedFromTaskId`) is in `parentIds`: a walk step's
 *  children. */
export function tasksByParentIds(parentIds: string[], projectId: string): Kin[] {
  if (parentIds.length === 0) return [];
  return db
    .select(KIN_COLUMNS)
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        inArray(schema.tasks.proposedFromTaskId, parentIds),
      ),
    )
    .all();
}
