// Queries for `demo.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export function projectBySlug(slug: string): typeof schema.projects.$inferSelect | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.slug, slug)).get();
}

export function insertDemoProject(input: {
  project: typeof schema.projects.$inferInsert;
  environment: typeof schema.environments.$inferInsert;
  agent: typeof schema.agents.$inferInsert;
  tasks: (typeof schema.tasks.$inferInsert)[];
}): void {
  db.insert(schema.projects).values(input.project).run();
  db.insert(schema.environments).values(input.environment).run();
  db.insert(schema.agents).values(input.agent).run();
  for (const task of input.tasks) db.insert(schema.tasks).values(task).run();
}
