// The task and its project, which the artifacts folder needs together.
import { eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export type TaskAndProject = {
  task: typeof schema.tasks.$inferSelect;
  project: typeof schema.projects.$inferSelect;
};

/** `null` when the task (or its project) does not exist: the caller's 404. */
export function taskWithProject(taskId: string): TaskAndProject | null {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) return null;
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, task.projectId))
    .get();
  if (!project) return null;
  return { task, project };
}
