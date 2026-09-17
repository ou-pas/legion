// The transaction order is the batch's behaviour, and it stays written in `slices.ts` (see its
// header): this module only provides the transaction and the insert.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type TaskRow = typeof schema.tasks.$inferSelect;
type AgentRow = typeof schema.agents.$inferSelect;
type TaskTemplateRow = typeof schema.taskTemplates.$inferSelect;

/** The handle writers insert through, structural like the one in `blockers-store.ts`: bare `db`
 *  and the Drizzle transaction inherit `insert` from the same parent. */
export type LotWriter = Pick<typeof db, "insert">;

export function taskById(id: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

/** A chain template, for its `steps` (JSON): `slices.ts` decodes them and decides whether the step
 *  approves a batch. */
export function chainTemplateById(id: string): TaskTemplateRow | undefined {
  return db.select().from(schema.taskTemplates).where(eq(schema.taskTemplates.id, id)).get();
}

export function projectPaths(
  projectId: string,
): { slug: string; fsRoot: string | null } | undefined {
  return db
    .select({ slug: schema.projects.slug, fsRoot: schema.projects.fsRoot })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
}

export function agentsOfProject(projectId: string): AgentRow[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

/** The project's "chain role → agent" mapping as stored (JSON, or `null` when the project does not
 *  exist): `slices.ts` decides what to do with unreadable text. */
export function projectChainBindings(projectId: string): string | null {
  return (
    db
      .select({ chainBindings: schema.projects.chainBindings })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get()?.chainBindings ?? null
  );
}

/** The batch transaction: all or nothing (see `approveLot`). `tx` is handed to the caller so the
 *  links from `blockers-store.ts` land in it by construction. */
export function inLotTransaction<T>(fn: (tx: LotWriter) => T): T {
  return db.transaction((tx) => fn(tx));
}

export function insertSliceTask(tx: LotWriter, row: typeof schema.tasks.$inferInsert): void {
  tx.insert(schema.tasks).values(row).run();
}
