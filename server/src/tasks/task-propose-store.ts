// Session and origin task, project agent names (for suggestion resolution), the session's existing
// filings (for the cap and to restrict `blockerIds` to this session's own filings), and the
// transactional insert of the filed task with its blockers.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { addBlocker } from "./blockers-store.js";

export function findSessionRow(sessionId: string): typeof schema.sessions.$inferSelect | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
}

export function findTaskRow(taskId: string): typeof schema.tasks.$inferSelect | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

/** The project's agent names as the project writes them: `resolveSuggestion` compares ignoring case
 *  but returns the project's case. */
export function projectAgentNames(projectId: string): string[] {
  return db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all()
    .map((r) => r.name);
}

/** The ids already filed by this session: for the cap and for `blockerIds` (an agent only orders
 *  what it just filed itself, see `task-propose.ts`). Re-read on each call rather than kept in
 *  process memory: the cap must hold across a resume (new container, same sessionId) and a control
 *  plane restart. */
export function sessionDepositIds(sessionId: string): string[] {
  return db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.proposedBySessionId, sessionId))
    .all()
    .map((r) => r.id);
}

/** Inserts the filed task with its declared blockers (`blockerIds`) and, if `blockOriginId` is
 *  given, the dependency holding the origin task (`blocking` behaviour), in one transaction: a
 *  half-set filing (task created, link missing) would refile under the cap without ever recovering
 *  the intended order. */
export function insertProposedTask(
  task: typeof schema.tasks.$inferInsert,
  blockerIds: string[],
  blockOriginId: string | null,
): typeof schema.tasks.$inferSelect {
  return db.transaction((tx) => {
    tx.insert(schema.tasks).values(task).run();
    // `addBlocker` is idempotent: a list repeating an id sets one link, not two.
    for (const id of blockerIds) addBlocker(task.id, id, tx);
    if (blockOriginId) addBlocker(blockOriginId, task.id, tx);
    const created = tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
    if (!created) throw new Error(`proposed task “${task.id}” not found after its insertion`);
    return created;
  });
}
