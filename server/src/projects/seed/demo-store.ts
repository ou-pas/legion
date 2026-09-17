// Drizzle writes for `pnpm seed:demo`; data lives in `demo.ts`, where `dropDemo` keeps its raw
// `better-sqlite3` connection.
import { db, schema } from "../../shared/db.js";

export function insertRunnerRow(row: typeof schema.runners.$inferInsert): void {
  db.insert(schema.runners).values(row).run();
}

export function insertProjectRow(row: typeof schema.projects.$inferInsert): void {
  db.insert(schema.projects).values(row).run();
}

export function insertEnvironmentRows(rows: (typeof schema.environments.$inferInsert)[]): void {
  db.insert(schema.environments).values(rows).run();
}

export function insertRepoRows(rows: (typeof schema.repos.$inferInsert)[]): void {
  db.insert(schema.repos).values(rows).run();
}

export function insertRuleRows(rows: (typeof schema.rules.$inferInsert)[]): void {
  db.insert(schema.rules).values(rows).run();
}

export function insertMcpServerRows(rows: (typeof schema.mcpServers.$inferInsert)[]): void {
  db.insert(schema.mcpServers).values(rows).run();
}

export function insertAgentRows(rows: (typeof schema.agents.$inferInsert)[]): void {
  db.insert(schema.agents).values(rows).run();
}

export function insertTaskTemplateRow(row: typeof schema.taskTemplates.$inferInsert): void {
  db.insert(schema.taskTemplates).values(row).run();
}

export function insertTaskRows(rows: (typeof schema.tasks.$inferInsert)[]): void {
  db.insert(schema.tasks).values(rows).run();
}

export function insertSessionRows(rows: (typeof schema.sessions.$inferInsert)[]): void {
  db.insert(schema.sessions).values(rows).run();
}

export function insertSessionEventRows(rows: (typeof schema.sessionEvents.$inferInsert)[]): void {
  db.insert(schema.sessionEvents).values(rows).run();
}

export function insertInboxMessageRows(rows: (typeof schema.inboxMessages.$inferInsert)[]): void {
  db.insert(schema.inboxMessages).values(rows).run();
}

export function insertTaskActivityRows(rows: (typeof schema.taskActivity.$inferInsert)[]): void {
  db.insert(schema.taskActivity).values(rows).run();
}

export function insertGoalRows(rows: (typeof schema.goals.$inferInsert)[]): void {
  db.insert(schema.goals).values(rows).run();
}

export function insertGoalEventRows(rows: (typeof schema.goalEvents.$inferInsert)[]): void {
  db.insert(schema.goalEvents).values(rows).run();
}

export function insertNoticeRows(rows: (typeof schema.notices.$inferInsert)[]): void {
  db.insert(schema.notices).values(rows).run();
}
