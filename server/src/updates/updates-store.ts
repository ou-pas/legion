// Update domain queries; nothing is decided here. One store for the whole domain: each rule file
// has one to three queries, and four tiny stores would hide nothing more.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { INBOX_STATUS } from "../inbox/inbox-enums.js";
import { WAIT_REASON } from "../inbox/wait-reason.js";

export type RunnerRow = typeof schema.runners.$inferSelect;
export type RepoRow = typeof schema.repos.$inferSelect;
export type InboxRow = typeof schema.inboxMessages.$inferSelect;
export type SessionStatus = typeof schema.sessions.$inferSelect.status;

/** `versionState` counts them and `suspendActiveSessions` suspends them with the same
 *  `OCCUPYING_STATUSES` (`infra/runner/limits.ts`): one query, so guard and screen cannot disagree. */
export function occupyingSessionIds(statuses: readonly SessionStatus[]): string[] {
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(inArray(schema.sessions.status, [...statuses]))
    .all()
    .map((r) => r.id);
}

/** Unfiltered: choosing remote machines is `activeSshRunners`'s rule. */
export function allRunners(): RunnerRow[] {
  return db.select().from(schema.runners).all();
}

/** Unfiltered: matching a forge slug to a project is `tokenForSlug`'s rule. */
export function allRepos(): RepoRow[] {
  return db.select().from(schema.repos).all();
}

/** The inbox body once the pause is known to be imposed. `pauseForOperator`'s body says the
 *  operator asked and should answer to resume; during an update both are false, and answering by
 *  hand would restart the session against images still rebuilding (04/09 outage). Resume goes
 *  through `resumeUpdatePauses`, which waits for `updateInFlight()` to fall. */
const UPDATE_PAUSE_BODY =
  "Suspended by the control plane for the duration of an update. I pushed what I had and stopped at the end of my turn. I will start again on my own as soon as the update is finished — nothing to answer.";

/** Moves the wait reason from `operator-pause` to `update-pause` and rewrites the body, in one
 *  `UPDATE`: a system reason on a body talking about the operator's request is the very confusion
 *  being fixed. Returns rows touched; an answered entry is not one. */
export function markPauseAsUpdatePause(sessionId: string): number {
  return db
    .update(schema.inboxMessages)
    .set({ reason: WAIT_REASON.updatePause, body: UPDATE_PAUSE_BODY })
    .where(
      and(
        eq(schema.inboxMessages.sessionId, sessionId),
        isNull(schema.inboxMessages.answeredAt),
        eq(schema.inboxMessages.reason, WAIT_REASON.operatorPause),
      ),
    )
    .run().changes;
}

/** Open inbox entries an update put to sleep. */
export function openUpdatePauses(): InboxRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        eq(schema.inboxMessages.status, INBOX_STATUS.open),
        eq(schema.inboxMessages.reason, WAIT_REASON.updatePause),
      ),
    )
    .all();
}
