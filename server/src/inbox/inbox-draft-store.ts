// Reads and writes behind `inbox-draft.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type InboxDraftRow = Pick<
  typeof schema.inboxMessages.$inferSelect,
  "status" | "form" | "sessionId"
>;

export function inboxDraftRowById(id: string): InboxDraftRow | undefined {
  return db
    .select({
      status: schema.inboxMessages.status,
      form: schema.inboxMessages.form,
      sessionId: schema.inboxMessages.sessionId,
    })
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.id, id))
    .get();
}

export function writeDraft(id: string, draftJson: string): void {
  db.update(schema.inboxMessages)
    .set({ draft: draftJson, draftAt: new Date() })
    .where(eq(schema.inboxMessages.id, id))
    .run();
}
