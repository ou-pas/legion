// Validating a slice names all its faults at once, in vocabulary order, and a value with several
// carries them all on its line ("decoupe" spec, behaviour 6). A refusal naming only the first fault
// makes the agent refile three times for one correction round.
//
// No database: this module is pure computation on what an agent wrote.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCriteria, readCriteria, renderCriteria, validateSlice } from "./criteria.js";

/** A sound slice: each failure case starts from it and breaks one thing. */
const sound = {
  label: "A task's criteria",
  outcome: "A task with criteria shows them and refuses done to its agent",
  validatedBy: "node --import tsx --test server/src/tasks/criteria.test.ts",
  items: [
    { text: "validation names each fault", mode: "test" },
    { text: "the rank boundary is covered", mode: "property", edge: "B6/boundary" },
  ],
  blockedBy: [1, 2],
};

describe("validateSlice: a sound slice", () => {
  it("says nothing about a slice that holds, in a batch or outside one", () => {
    assert.deepEqual(validateSlice(sound, 3), []);
    assert.deepEqual(validateSlice({ validatedBy: sound.validatedBy, items: sound.items }), []);
  });

  it("accepts one and three criteria, refuses zero and four", () => {
    const one = [{ text: "one", mode: "test" }];
    assert.deepEqual(validateSlice({ ...sound, items: one }, 3), []);
    assert.deepEqual(validateSlice({ ...sound, items: [...one, ...one, ...one] }, 3), []);
    assert.deepEqual(validateSlice({ ...sound, items: [] }, 3), ["no criterion"]);
    assert.deepEqual(validateSlice({ ...sound, items: [...one, ...one, ...one, ...one] }, 3), [
      "more than three criteria (4)",
    ]);
  });

  it("an empty blocker list is not a fault: behaviour 6's closed list does not mention it", () => {
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [] }, 3), []);
  });
});

describe("validateSlice: empty is read after stripping all whitespace", () => {
  it("spaces, tab, newline and non-breaking space count as empty", () => {
    for (const blank of [" ", "\t", "\n", " ", "  \t\n "]) {
      assert.deepEqual(
        validateSlice({ ...sound, label: blank, outcome: blank, validatedBy: blank }, 3),
        ["empty label", "empty observable outcome", "empty validation command"],
        `"${JSON.stringify(blank)}" must count as empty`,
      );
    }
  });

  it("a criterion text made of whitespace counts as empty", () => {
    assert.deepEqual(validateSlice({ ...sound, items: [{ text: "  ", mode: "test" }] }, 3), [
      "criterion 1: empty text",
    ]);
  });
});

describe("validateSlice: a criterion's faults", () => {
  it("names the unknown mode as written", () => {
    assert.deepEqual(validateSlice({ ...sound, items: [{ text: "t", mode: "manual" }] }, 3), [
      "criterion 1: unknown mode “manual”",
    ]);
  });

  it("a property criterion without an edge, or with a malformed edge, is refused", () => {
    assert.deepEqual(validateSlice({ ...sound, items: [{ text: "t", mode: "property" }] }, 3), [
      "criterion 1: property mode without an edge",
    ]);
    // `B0/…` (zero), `B04/…` (leading zero) and a category outside the probe's eight words.
    for (const edge of ["B0/empty", "B04/empty", "B4/void", "4/empty", "B4-empty"]) {
      assert.deepEqual(
        validateSlice({ ...sound, items: [{ text: "t", mode: "property", edge }] }, 3),
        [`criterion 1: malformed edge “${edge}”`],
        `"${edge}" does not have the vocabulary's shape`,
      );
    }
  });

  it("an edge carried by a non-property criterion is ignored", () => {
    assert.deepEqual(
      validateSlice({ ...sound, items: [{ text: "t", mode: "test", edge: "anything" }] }, 3),
      [],
    );
  });

  it("a criterion with several faults carries them all on its line, in list order", () => {
    assert.deepEqual(validateSlice({ ...sound, items: [{ text: "  ", mode: "screenshot" }] }, 3), [
      "criterion 1: empty text, unknown mode “screenshot”",
    ]);
    assert.deepEqual(
      validateSlice({ ...sound, items: [{ text: "", mode: "property", edge: "B0/empty" }] }, 3),
      ["criterion 1: empty text, malformed edge “B0/empty”"],
    );
  });

  it("one line per faulty criterion, ascending positions, sound ones skipped", () => {
    assert.deepEqual(
      validateSlice(
        {
          ...sound,
          items: [
            { text: "", mode: "test" },
            { text: "ok", mode: "test" },
            { text: "x", mode: "nope" },
          ],
        },
        3,
      ),
      ["criterion 1: empty text", "criterion 3: unknown mode “nope”"],
    );
  });
});

describe("validateSlice: a blocker's faults", () => {
  it("a blocker outside the batch is named, valid and invalid ranks at the bounds", () => {
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [1, 3] }, 3), []);
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [0, 4] }, 3), [
      "blocker 0: points at no rank of the batch (1 to 3)",
      "blocker 4: points at no rank of the batch (1 to 3)",
    ]);
  });

  it("a rank that is not an integer designates no rank", () => {
    assert.deepEqual(validateSlice({ ...sound, blockedBy: ["2"] }, 3), [
      "blocker “2”: points at no rank of the batch (1 to 3)",
    ]);
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [1.5] }, 3), [
      "blocker 1.5: points at no rank of the batch (1 to 3)",
    ]);
  });

  it("a blocker cited twice is said once, and combines with outside the batch", () => {
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [2, 2] }, 3), ["blocker 2: cited twice"]);
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [9, 9] }, 3), [
      "blocker 9: points at no rank of the batch (1 to 3), cited twice",
    ]);
  });

  it("faulty blockers come out in ascending values, whatever the written order", () => {
    assert.deepEqual(validateSlice({ ...sound, blockedBy: [7, 0, 4, 7] }, 3), [
      "blocker 0: points at no rank of the batch (1 to 3)",
      "blocker 4: points at no rank of the batch (1 to 3)",
      "blocker 7: points at no rank of the batch (1 to 3), cited twice",
    ]);
  });
});

describe("validateSlice: vocabulary field order", () => {
  it("a fully faulty slice names them all, label → outcome → command → criteria → blockers", () => {
    assert.deepEqual(
      validateSlice(
        {
          label: " ",
          outcome: "",
          validatedBy: "\n",
          items: [
            { text: "", mode: "test" },
            { text: "t", mode: "property", edge: "" },
          ],
          blockedBy: [5, 5, 1],
        },
        2,
      ),
      [
        "empty label",
        "empty observable outcome",
        "empty validation command",
        "criterion 1: empty text",
        "criterion 2: property mode without an edge",
        "blocker 5: points at no rank of the batch (1 to 2), cited twice",
      ],
    );
  });

  it("outside a batch (a leftover), batch-only fields are not required", () => {
    assert.deepEqual(
      validateSlice({ validatedBy: "make gates", items: [{ text: "t", mode: "human" }] }),
      [],
    );
    assert.deepEqual(validateSlice({ items: [{ text: "t", mode: "human" }] }), [
      "empty validation command",
    ]);
  });
});

describe("parseCriteria: tolerant, never an exception", () => {
  it("returns null on null, empty, invalid JSON and wrong shape", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "   ",
      "{",
      "[]",
      '"text"',
      "42",
      '{"items":[]}',
      '{"validatedBy":"c"}',
      '{"validatedBy":1,"items":[]}',
      '{"validatedBy":"c","items":[{"text":"t"}]}',
      '{"validatedBy":"c","items":[{"text":"t","mode":"manual"}]}',
      '{"validatedBy":"c","items":[{"text":1,"mode":"test"}]}',
    ])
      assert.equal(parseCriteria(raw), null, `${String(raw)} is unreadable`);
  });

  it("re-reads what it writes, and drops a non-property criterion's edge", () => {
    const value = readCriteria({
      validatedBy: "pnpm -s test",
      items: [
        { text: "a", mode: "test", edge: "B1/empty" },
        { text: "b", mode: "property", edge: "B1/empty" },
      ],
    });
    assert.deepEqual(value, {
      validatedBy: "pnpm -s test",
      items: [
        { text: "a", mode: "test" },
        { text: "b", mode: "property", edge: "B1/empty" },
      ],
    });
    assert.deepEqual(parseCriteria(JSON.stringify(value)), value);
  });
});

describe("renderCriteria: one text for the brief and the page", () => {
  it("the command first, then criteria numbered 1 to 3 with their mode, in order", () => {
    assert.equal(
      renderCriteria({
        validatedBy: "pnpm -s test",
        items: [
          { text: "the first", mode: "test" },
          { text: "the second", mode: "property", edge: "B6/boundary" },
          { text: "the third", mode: "human" },
        ],
      }),
      "## What this task must prove\n" +
        "Validation command: pnpm -s test\n" +
        "1. [test] the first\n" +
        "2. [property] the second (edge B6/boundary)\n" +
        "3. [human] the third",
    );
  });
});
