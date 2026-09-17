// Inbox queue order (07/09): "needs me" first. The list came out in table insertion order, which says
// nothing: a wait that wakes by itself could pass a started round, unexplained.
//
// Three tiers, in this order:
//
//  1. STARTED ROUNDS first. A draft is work begun: finishing it is cheaper than starting another, and
//     leaving it is how the same question gets answered twice.
//  2. BLANK QUESTIONS next, OLDEST first: the only honest measure of who waited longest, already the
//     waiting panel's rule (`pending-entries.ts`).
//  3. NOTICES last (task wait, out-of-quota pause, requested pause): they wake by themselves, nobody
//     has anything to do.
//
// A FOURTH tier (answered questions, collapsed) is in the mockup but absent: `/api/inbox` is a QUEUE of
// open items. A question's history is on its page, a task's in its channel.
//
// Pure, no React.
import type { InboxItem } from "../api/inbox.js";

/** An item's tier. Exported so the screen groups under subheadings that NAME it: without them a sort
 *  is an order one just suffers. */
export type InboxTier = "draft" | "fresh" | "notice";

/** An item that wakes BY ITSELF calls nobody. Same definition as the rail badge
 *  (server/src/inbox/pending-by-project.ts) and the waiting panel: three lists diverging here would cast
 *  doubt on all three. */
const isNotice = (item: InboxItem): boolean => item.waitForTaskId !== null || item.wakeAt !== null;

export function tierOf(item: InboxItem): InboxTier {
  if (isNotice(item)) return "notice";
  return item.answered > 0 ? "draft" : "fresh";
}

const RANK: Record<InboxTier, number> = { draft: 0, fresh: 1, notice: 2 };

/** The sorted queue. Does NOT mutate the input: an in-place sort of React Query data would vary the
 *  order between renders depending on who read the cache first. */
export function orderInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const byTier = RANK[tierOf(a)] - RANK[tierOf(b)];
    // At equal tier, OLDEST FIRST, drafts included: what waited longest goes first, and the rank stays
    // put until answered.
    return byTier !== 0 ? byTier : a.createdAt - b.createdAt;
  });
}

/** A tier's items, in order, so the screen writes its three sections without refiltering, and an empty
 *  tier renders no subheading. */
export const inTier = (items: readonly InboxItem[], tier: InboxTier): InboxItem[] =>
  orderInbox(items).filter((item) => tierOf(item) === tier);
