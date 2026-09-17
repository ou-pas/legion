// Review domain queries: pre-review (diff, comments) and the send flow. Nothing decides here;
// `review.ts` knows what the statuses it passes mean. `isDemoProject` is re-exported so the domain
// never touches `shared/db.js`.
import { and, eq } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";

export { isDemoProject };

export type TaskRow = typeof schema.tasks.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;
export type ReviewCommentRow = typeof schema.reviewComments.$inferSelect;
export type NewReviewComment = typeof schema.reviewComments.$inferInsert;
export type RepoRow = typeof schema.repos.$inferSelect;

export function taskRow(taskId: string): TaskRow | null {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() ?? null;
}

export function sessionsOfTask(taskId: string): SessionRow[] {
  return db.select().from(schema.sessions).where(eq(schema.sessions.taskId, taskId)).all();
}

export function reviewCommentsOfTask(taskId: string): ReviewCommentRow[] {
  return db
    .select()
    .from(schema.reviewComments)
    .where(eq(schema.reviewComments.taskId, taskId))
    .all();
}

/** A task's comments in a given status. The status is an argument, never guessed here: `review.ts`
 *  knows what `open` means. */
export function reviewCommentsOfTaskByStatus(
  taskId: string,
  status: ReviewCommentRow["status"],
): ReviewCommentRow[] {
  return db
    .select()
    .from(schema.reviewComments)
    .where(and(eq(schema.reviewComments.taskId, taskId), eq(schema.reviewComments.status, status)))
    .all();
}

export function reviewCommentRow(id: string): ReviewCommentRow | null {
  return (
    db.select().from(schema.reviewComments).where(eq(schema.reviewComments.id, id)).get() ?? null
  );
}

export function reposOfProject(projectId: string): RepoRow[] {
  return db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();
}

export function insertReviewComment(row: NewReviewComment): void {
  db.insert(schema.reviewComments).values(row).run();
}

export function deleteReviewCommentRow(id: string): void {
  db.delete(schema.reviewComments).where(eq(schema.reviewComments.id, id)).run();
}

/** Batch update: sending a review and restoring it when the rerun fails always touch several
 *  comments at once. */
export function setReviewCommentsStatus(
  ids: readonly string[],
  status: ReviewCommentRow["status"],
  sentAt: Date | null,
): void {
  for (const id of ids)
    db.update(schema.reviewComments)
      .set({ status, sentAt })
      .where(eq(schema.reviewComments.id, id))
      .run();
}
