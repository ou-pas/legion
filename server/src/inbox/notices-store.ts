// Notice persistence. `notices.ts` stays the entry point.
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export function insertNotice(body: string, kind: string): void {
  db.insert(schema.notices)
    .values({ id: nanoid(10), kind, body, read: false, createdAt: new Date() })
    .run();
}

export function unreadNotices() {
  return db.select().from(schema.notices).where(eq(schema.notices.read, false)).all();
}

export function markNoticeReadRow(id: string): void {
  db.update(schema.notices).set({ read: true }).where(eq(schema.notices.id, id)).run();
}
