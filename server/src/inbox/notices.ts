// Notices: informational inbox messages, with no session and no expected answer (v14).
//
// Split from `inbox.ts` on 05/09 for dependencies, not size: `inbox.ts` imports the runner
// (answering resumes the session), so any runner-imported module posting a notice closed an
// `inbox → manager → … → inbox` cycle. A notice needs only the database.
import { insertNotice, markNoticeReadRow, unreadNotices } from "./notices-store.js";

export function addNotice(body: string, kind = "info"): void {
  insertNotice(body, kind);
}

export function listNotices() {
  return unreadNotices().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function markNoticeRead(id: string): void {
  markNoticeReadRow(id);
}
