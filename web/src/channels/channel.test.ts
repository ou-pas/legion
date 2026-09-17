// Grouping channels waiting on the same question, the rule alone.
import { describe, expect, it } from "vitest";
import { groupWaitingByQuestion } from "./channel.js";
import { channel, question } from "./fixtures.js";

describe("groupWaitingByQuestion", () => {
  it("leaves a single channel as is: a duplicate needs two", () => {
    const c = channel({ name: "t1", question: question() });
    expect(groupWaitingByQuestion([c])).toEqual([{ kind: "single", channel: c }]);
  });

  it("groups two or more channels asking the same question", () => {
    const q = question({ body: "Budget reached, shall I continue?" });
    const channels = [
      channel({ name: "t1", question: q }),
      channel({ name: "t2", question: q }),
      channel({ name: "t3", question: q }),
      channel({ name: "t4", question: q }),
    ];
    expect(groupWaitingByQuestion(channels)).toEqual([
      { kind: "group", question: "Budget reached, shall I continue?", channels },
    ]);
  });

  it("normalises case and spaces before comparing", () => {
    const channels = [
      channel({
        name: "t1",
        question: question({ body: "  Budget reached, shall I continue?  " }),
      }),
      channel({ name: "t2", question: question({ body: "budget reached, shall i continue?" }) }),
    ];
    const result = groupWaitingByQuestion(channels);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "group", channels });
  });

  it("does not mix two interleaved groups: one per question, in order of first appearance", () => {
    const budget = question({ body: "Budget reached, shall I continue?" });
    const php = question({ body: "No PHP environment, how to proceed?" });
    const channels = [
      channel({ name: "t1", question: php }),
      channel({ name: "t2", question: budget }),
      channel({ name: "t3", question: budget }),
      channel({ name: "t4", question: php }),
    ];
    expect(groupWaitingByQuestion(channels)).toEqual([
      { kind: "group", question: php.body, channels: [channels[0], channels[3]] },
      { kind: "group", question: budget.body, channels: [channels[1], channels[2]] },
    ]);
  });

  it("a duplicate (2) and a unique channel in one list: only the duplicate groups", () => {
    const budget = question({ body: "Budget reached, shall I continue?" });
    const unique = question({ body: "Should the Stripe webhook be migrated now?" });
    const channels = [
      channel({ name: "t1", question: unique }),
      channel({ name: "t2", question: budget }),
      channel({ name: "t3", question: budget }),
    ];
    expect(groupWaitingByQuestion(channels)).toEqual([
      { kind: "single", channel: channels[0] },
      { kind: "group", question: budget.body, channels: [channels[1], channels[2]] },
    ]);
  });

  it("a channel without question (gate only) stays single, never grouped", () => {
    const c = channel({ name: "t1", question: null, gate: true });
    expect(groupWaitingByQuestion([c])).toEqual([{ kind: "single", channel: c }]);
  });
});
