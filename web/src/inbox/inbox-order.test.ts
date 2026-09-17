// Queue order (07/09). Sorting is what makes a queue usable, and it breaks silently: nothing on screen
// says an item is misplaced. Three properties, one per tier.
import { describe, expect, it } from "vitest";
import type { InboxItem } from "../api/inbox.js";
import { inTier, orderInbox, tierOf } from "./inbox-order.js";
import { INBOX_KIND } from "../api/inbox.js";

const NOW = Date.parse("2026-09-07T17:00:00Z");
const MIN = 60_000;

const item = (over: Partial<InboxItem> & { id: string }): InboxItem => ({
  kind: INBOX_KIND.form,
  body: "Round",
  evidence: null,
  impact: null,
  choices: null,
  form: null,
  taskId: "t1",
  taskName: "T",
  agentName: "interviewer",
  sessionId: "s1",
  projectId: "p1",
  createdAt: NOW - 10 * MIN,
  wakeAt: null,
  waitForTaskId: null,
  waitForTaskName: null,
  waitForTaskStatus: null,
  reason: "question",
  answered: 0,
  total: 6,
  draft: null,
  draftAt: null,
  roundIndex: 1,
  ...over,
});

describe("tierOf", () => {
  it("a started round is work begun", () => {
    expect(tierOf(item({ id: "a", answered: 2 }))).toBe("draft");
  });

  it("a blank question waits, so does a round at zero", () => {
    expect(tierOf(item({ id: "b" }))).toBe("fresh");
    expect(tierOf(item({ id: "c", total: 0 }))).toBe("fresh");
  });

  it("what wakes BY ITSELF calls nobody: same definition as the rail badge", () => {
    expect(tierOf(item({ id: "d", waitForTaskId: "t2" }))).toBe("notice");
    expect(tierOf(item({ id: "e", wakeAt: NOW + MIN }))).toBe("notice");
    // A STARTED notice stays a notice: the tier depends on who waits, not on work done.
    expect(tierOf(item({ id: "f", wakeAt: NOW + MIN, answered: 3 }))).toBe("notice");
  });
});

describe("orderInbox", () => {
  it("brouillons, puis vierges, puis avis", () => {
    const order = orderInbox([
      item({ id: "avis", waitForTaskId: "t2", createdAt: NOW - 300 * MIN }),
      item({ id: "vierge", createdAt: NOW - 5 * MIN }),
      item({ id: "entame", answered: 2, createdAt: NOW - 2 * MIN }),
    ]);
    // The notice is the OLDEST of the three and still goes last: tier beats age, since nobody has
    // anything to answer.
    expect(order.map((i) => i.id)).toEqual(["entame", "vierge", "avis"]);
  });

  it("at equal tier, oldest first: it waited longest", () => {
    const order = orderInbox([
      item({ id: "recent", createdAt: NOW - 2 * MIN }),
      item({ id: "vieux", createdAt: NOW - 200 * MIN }),
    ]);
    expect(order.map((i) => i.id)).toEqual(["vieux", "recent"]);
  });

  it("does not mutate the input: two readers of one cache see the same order", () => {
    const input = [item({ id: "b", createdAt: NOW }), item({ id: "a", createdAt: NOW - MIN })];
    orderInbox(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("inTier", () => {
  it("returns the requested tier, in order, and nothing else", () => {
    const items = [
      item({ id: "avis", waitForTaskId: "t2" }),
      item({ id: "e2", answered: 1, createdAt: NOW - MIN }),
      item({ id: "e1", answered: 1, createdAt: NOW - 50 * MIN }),
    ];
    expect(inTier(items, "draft").map((i) => i.id)).toEqual(["e1", "e2"]);
    expect(inTier(items, "notice").map((i) => i.id)).toEqual(["avis"]);
    expect(inTier(items, "fresh")).toEqual([]);
  });
});
