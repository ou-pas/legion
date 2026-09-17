// Interview `OgH7TFVsRH`, cut at round 2 on 14/09: round 1's four decisions ended up as opaque
// keys in a database column, unreadable even by the resuming agent. The log must show the chosen
// label and the reason given with the question, never the option id.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderRound } from "./round-log.js";
import type { InboxMessageRow } from "./inbox-store.js";

const AT = new Date("2026-09-14T16:21:50.000Z");

/** Round 1 of `OgH7TFVsRH`, reduced to what decides. */
function round(over: Partial<InboxMessageRow> = {}): InboxMessageRow {
  return {
    body: "Task page header on a phone: what stays, what folds",
    evidence: "Measured at 375 × 812: the header costs 106 to 273px.",
    impact: "Decides the spec and the implementation task.",
    form: JSON.stringify({
      blocks: [
        { kind: "markdown", text: "context that is not a question" },
        {
          kind: "field",
          field: {
            id: "gestures",
            label: "On a phone, how do the gestures fit?",
            hint: "Recommended: the menu, because it carries written labels.",
            options: [
              { id: "menu", label: "The main gesture, the rest in a “…” menu" },
              { id: "scroll", label: "A single scrolling row" },
            ],
          },
        },
      ],
    }),
    answerText: JSON.stringify({ gestures: "menu" }),
    ...over,
  } as InboxMessageRow;
}

describe("renderRound", () => {
  it("renders the chosen label, never the form key", () => {
    const md = renderRound(round(), AT) ?? "";
    assert.ok(md.includes("The main gesture, the rest in a “…” menu"), md);
    assert.ok(!md.includes("→ menu"), "the opaque key must not reach the log");
  });

  // The only trace of the reasoning.
  it("keeps the reason given with the question, and the measurements", () => {
    const md = renderRound(round(), AT) ?? "";
    assert.ok(md.includes("because it carries written labels"), md);
    assert.ok(md.includes("106 to 273px"), md);
  });

  // An optional field left empty is information: the next session knows it may ask again.
  it("writes an unanswered question, saying so", () => {
    const md = renderRound(round({ answerText: "{}" }), AT) ?? "";
    assert.ok(md.includes("On a phone, how do the gestures fit?"), md);
    assert.ok(md.includes("no answer"), md);
  });

  // The form makes the round; logging every round trip would drown the decisions.
  it("does not log an entry without a form", () => {
    assert.equal(renderRound(round({ form: null }), AT), null);
    assert.equal(renderRound(round({ form: "{}" }), AT), null);
  });

  // Model-written JSON: a broken form must not lose the round or throw on the answering path.
  it("does not throw on an unreadable form or answer", () => {
    assert.equal(renderRound(round({ form: "{not json" }), AT), null);
    const md = renderRound(round({ answerText: "{not json" }), AT) ?? "";
    assert.ok(md.includes("no answer"), md);
  });

  it("renders a free answer as-is: it is its own label", () => {
    const md = renderRound(
      round({ answerText: JSON.stringify({ gestures: "something else" }) }),
      AT,
    );
    assert.ok((md ?? "").includes("something else"), md ?? "");
  });
});
