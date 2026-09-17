// Queries for `project-edit.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type ProjectPatch = Partial<typeof schema.projects.$inferInsert>;

export function projectRowById(id: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export function slugTaken(slug: string): boolean {
  return (
    db.select().from(schema.projects).where(eq(schema.projects.slug, slug)).get() !== undefined
  );
}

export function agentRowsOfProject(projectId: string): (typeof schema.agents.$inferSelect)[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

export function updateProjectRow(id: string, patch: ProjectPatch): void {
  db.update(schema.projects).set(patch).where(eq(schema.projects.id, id)).run();
}
