// Raw reads behind `pendingByProject`. What counts as blocking someone is decided in
// `pending-by-project.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { INBOX_STATUS } from "./inbox-enums.js";

export function allProjectIds(): string[] {
  return db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .all()
    .map((p) => p.id);
}

export type OpenInboxRow = {
  projectId: string;
  waitForTaskId: string | null;
  wakeAt: Date | null;
};

export function openInboxRows(): OpenInboxRow[] {
  return db
    .select({
      projectId: schema.tasks.projectId,
      waitForTaskId: schema.inboxMessages.waitForTaskId,
      wakeAt: schema.inboxMessages.wakeAt,
    })
    .from(schema.inboxMessages)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.inboxMessages.taskId))
    .where(eq(schema.inboxMessages.status, INBOX_STATUS.open))
    .all();
}

export function reviewGateProjectIds(): string[] {
  return db
    .select({ projectId: schema.tasks.projectId })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.approvalGate, true), eq(schema.tasks.status, TASK_STATUS.review)))
    .all()
    .map((r) => r.projectId);
}
