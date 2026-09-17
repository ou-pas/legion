// Database access for `rule-edit.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type RuleRow = typeof schema.rules.$inferSelect;

export function repoNamesOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.projectId, projectId))
    .all()
    .map((r) => r.name);
}

export function rulesOf(projectId: string | undefined): RuleRow[] {
  return projectId
    ? db.select().from(schema.rules).where(eq(schema.rules.projectId, projectId)).all()
    : db.select().from(schema.rules).all();
}

export function getRule(ruleId: string): RuleRow | undefined {
  return db.select().from(schema.rules).where(eq(schema.rules.id, ruleId)).get();
}

export function insertRule(row: RuleRow): void {
  db.insert(schema.rules).values(row).run();
}

export function updateRule(ruleId: string, fields: Partial<RuleRow>): void {
  db.update(schema.rules).set(fields).where(eq(schema.rules.id, ruleId)).run();
}

export function deleteRuleRow(ruleId: string): void {
  db.delete(schema.rules).where(eq(schema.rules.id, ruleId)).run();
}
