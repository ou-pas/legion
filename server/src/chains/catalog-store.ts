// The operator's library (`agent_templates`, `chain_templates`), the copies installed in a project
// (`task_templates`, `agents`) and the tasks still following a chain. Statuses that matter, name
// collisions and 409 refusals are decided in `catalog.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type AgentTemplateRow = typeof schema.agentTemplates.$inferSelect;
type ChainTemplateRow = typeof schema.chainTemplates.$inferSelect;
type TaskTemplateRow = typeof schema.taskTemplates.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;
type AgentInsert = typeof schema.agents.$inferInsert;
type TaskTemplateInsert = typeof schema.taskTemplates.$inferInsert;
type ChainTemplateInsert = typeof schema.chainTemplates.$inferInsert;

export function promotedAgents(): AgentTemplateRow[] {
  return db.select().from(schema.agentTemplates).all();
}

export function promotedAgent(id: string): AgentTemplateRow | undefined {
  return db.select().from(schema.agentTemplates).where(eq(schema.agentTemplates.id, id)).get();
}

export function promotedChains(): ChainTemplateRow[] {
  return db.select().from(schema.chainTemplates).all();
}

export function promotedChain(id: string): ChainTemplateRow | undefined {
  return db.select().from(schema.chainTemplates).where(eq(schema.chainTemplates.id, id)).get();
}

export function projectExists(projectId: string): boolean {
  return Boolean(db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get());
}

export function agentNamesOfProject(projectId: string): string[] {
  return db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all()
    .map((a) => a.name);
}

export function insertAgent(values: AgentInsert): void {
  db.insert(schema.agents).values(values).run();
}

export function chainsOfProject(projectId: string): TaskTemplateRow[] {
  return db
    .select()
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.projectId, projectId))
    .all();
}

export function projectChain(id: string): TaskTemplateRow | undefined {
  return db.select().from(schema.taskTemplates).where(eq(schema.taskTemplates.id, id)).get();
}

/** A chain's missing step agents AND its copy, in one transaction: a half-installed chain is worse
 *  than none (see `installChain`). */
export function insertChainWithAgents(agents: readonly AgentInsert[], chain: TaskTemplateInsert) {
  db.transaction((tx) => {
    for (const values of agents) tx.insert(schema.agents).values(values).run();
    tx.insert(schema.taskTemplates).values(chain).run();
  });
}

export function updateChainSpec(
  id: string,
  spec: Pick<ChainTemplateRow, "description" | "steps" | "autoRunNext">,
): void {
  db.update(schema.chainTemplates).set(spec).where(eq(schema.chainTemplates.id, id)).run();
}

export function insertPromotedChain(values: ChainTemplateInsert): void {
  db.insert(schema.chainTemplates).values(values).run();
}

/** Every task carrying this `template_id`, whatever its status: `catalog.ts` knows which ones block
 *  the uninstall. */
export function tasksOfChain(templateId: string): TaskRow[] {
  return db.select().from(schema.tasks).where(eq(schema.tasks.templateId, templateId)).all();
}

export function deleteProjectChain(id: string): void {
  db.delete(schema.taskTemplates).where(eq(schema.taskTemplates.id, id)).run();
}

export function deletePromotedAgent(id: string): void {
  db.delete(schema.agentTemplates).where(eq(schema.agentTemplates.id, id)).run();
}

export function deletePromotedChain(id: string): void {
  db.delete(schema.chainTemplates).where(eq(schema.chainTemplates.id, id)).run();
}
