// Queries for `project-create.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type ProjectRow = typeof schema.projects.$inferSelect;

export function slugExists(slug: string): boolean {
  return (
    db.select().from(schema.projects).where(eq(schema.projects.slug, slug)).get() !== undefined
  );
}

export function projectById(id: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

/** Four rows or none (05/09): a failing default agent left a project without an agent. `repo` is
 *  `null` when creation carries no initial URL. */
export function insertProjectWithDefaults(input: {
  project: typeof schema.projects.$inferInsert;
  environment: typeof schema.environments.$inferInsert;
  repo: typeof schema.repos.$inferInsert | null;
  agent: typeof schema.agents.$inferInsert;
}): void {
  db.transaction((tx) => {
    tx.insert(schema.projects).values(input.project).run();
    tx.insert(schema.environments).values(input.environment).run();
    if (input.repo) tx.insert(schema.repos).values(input.repo).run();
    tx.insert(schema.agents).values(input.agent).run();
  });
}
