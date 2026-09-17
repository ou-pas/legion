// Database access for `notify.ts`: the `webhooks` table, raw rows.
// Event filtering, throttling and URL validation are decided in `notify.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type WebhookRow = typeof schema.webhooks.$inferSelect;

export function allWebhooks(): WebhookRow[] {
  return db.select().from(schema.webhooks).all();
}

export function insertWebhook(values: typeof schema.webhooks.$inferInsert): void {
  db.insert(schema.webhooks).values(values).run();
}

export function deleteWebhookRow(id: string): void {
  db.delete(schema.webhooks).where(eq(schema.webhooks.id, id)).run();
}

/** A task's project (name for the sentence, id for the URL), or `null` if the task is gone. Both
 *  in one query: this runs on every notifiable event. */
export function projectOfTask(taskId: string): { id: string; name: string } | null {
  const row = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(eq(schema.tasks.id, taskId))
    .get();
  return row ?? null;
}
