// Import writes. What enters is decided in `crate-apply.ts`. The transaction is provided here but
// its content and order belong to `applyCrate`: a half-done import would leave agents without their
// rules and a project nobody asked for.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type NewProject = typeof schema.projects.$inferInsert;
export type NewEnvironment = typeof schema.environments.$inferInsert;
export type NewRepo = typeof schema.repos.$inferInsert;
export type NewRule = typeof schema.rules.$inferInsert;
export type NewMcpServer = typeof schema.mcpServers.$inferInsert;
export type NewSecret = typeof schema.secrets.$inferInsert;
export type NewAgent = typeof schema.agents.$inferInsert;
export type NewTaskTemplate = typeof schema.taskTemplates.$inferInsert;

export function inImportTransaction(write: () => void): void {
  db.transaction(write);
}

export function projectSlugTaken(slug: string): boolean {
  return Boolean(db.select().from(schema.projects).where(eq(schema.projects.slug, slug)).get());
}

export function insertProject(row: NewProject): void {
  db.insert(schema.projects).values(row).run();
}

export function insertEnvironment(row: NewEnvironment): void {
  db.insert(schema.environments).values(row).run();
}

export function insertRepo(row: NewRepo): void {
  db.insert(schema.repos).values(row).run();
}

export function insertRule(row: NewRule): void {
  db.insert(schema.rules).values(row).run();
}

export function insertMcpServer(row: NewMcpServer): void {
  db.insert(schema.mcpServers).values(row).run();
}

export function insertSecret(row: NewSecret): void {
  db.insert(schema.secrets).values(row).run();
}

export function insertAgent(row: NewAgent): void {
  db.insert(schema.agents).values(row).run();
}

export function insertTaskTemplate(row: NewTaskTemplate): void {
  db.insert(schema.taskTemplates).values(row).run();
}

/** Written after the agents: the mapping points to ids that did not exist when the project row was
 *  inserted. */
export function setProjectChainBindings(projectId: string, chainBindings: string): void {
  db.update(schema.projects).set({ chainBindings }).where(eq(schema.projects.id, projectId)).run();
}
