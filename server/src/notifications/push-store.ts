// Database access for push: the `push_subscriptions` table, raw rows
//. Filtering, encryption and dead-subscription removal are decided
// in `push.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type PushSubscriptionRow = typeof schema.pushSubscriptions.$inferSelect;

export function allPushSubscriptions(): PushSubscriptionRow[] {
  return db.select().from(schema.pushSubscriptions).all();
}

/** Inserts the subscription, or updates the one with the same endpoint.
 *
 *  An upsert because the browser returns the same endpoint when it re-subscribes a known phone,
 *  and a plain `insert` would fail on uniqueness though nothing is wrong. The original id is
 *  kept. */
export function upsertPushSubscription(values: typeof schema.pushSubscriptions.$inferInsert): void {
  db.insert(schema.pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: {
        p256dh: values.p256dh,
        auth: values.auth,
        events: values.events,
        label: values.label,
        lastSeenAt: values.lastSeenAt,
      },
    })
    .run();
}

export function deletePushSubscriptionRow(id: string): void {
  db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, id)).run();
}

/** By endpoint, because that is what the push service gives back when it declares a
 *  subscription dead; it does not know our id. */
export function deletePushSubscriptionByEndpoint(endpoint: string): void {
  db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).run();
}

export function touchPushSubscription(id: string, at: Date): void {
  db.update(schema.pushSubscriptions)
    .set({ lastSeenAt: at })
    .where(eq(schema.pushSubscriptions.id, id))
    .run();
}
