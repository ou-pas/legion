// Queries for the boot seed; order and content live in `index.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export function hasAnyRunner(): boolean {
  return db.select({ id: schema.runners.id }).from(schema.runners).limit(1).get() !== undefined;
}

export function insertRunnerRow(row: typeof schema.runners.$inferInsert): void {
  db.insert(schema.runners).values(row).run();
}

export function ungrantedAgentRows(): { id: string; name: string }[] {
  return db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.fsGrants, "[]"))
    .all();
}

export function setAgentFsGrants(id: string, fsGrants: string): void {
  db.update(schema.agents).set({ fsGrants }).where(eq(schema.agents.id, id)).run();
}

export function hasAnyProjectRow(): boolean {
  return db.select({ id: schema.projects.id }).from(schema.projects).limit(1).get() !== undefined;
}

export function insertProjectRow(row: typeof schema.projects.$inferInsert): void {
  db.insert(schema.projects).values(row).run();
}

export function insertAgentRow(row: typeof schema.agents.$inferInsert): void {
  db.insert(schema.agents).values(row).run();
}

export function hasAnyEnvironmentRow(): boolean {
  return (
    db.select({ id: schema.environments.id }).from(schema.environments).limit(1).get() !== undefined
  );
}

export function insertEnvironmentRow(row: typeof schema.environments.$inferInsert): void {
  db.insert(schema.environments).values(row).run();
}

export function hasAnyTemplateRow(): boolean {
  return (
    db.select({ id: schema.taskTemplates.id }).from(schema.taskTemplates).limit(1).get() !==
    undefined
  );
}

export function agentRowExistsByName(name: string, projectId: string): boolean {
  return (
    db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.name, name), eq(schema.agents.projectId, projectId)))
      .get() !== undefined
  );
}

export function insertTaskTemplateRow(row: typeof schema.taskTemplates.$inferInsert): void {
  db.insert(schema.taskTemplates).values(row).run();
}
