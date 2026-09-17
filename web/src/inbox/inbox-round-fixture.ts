// The reference round of the stories: AI-2219's round 2 in its real shape (reread on 07/09 via
// /api/tasks/QPz8n67bhU/inbox-history), the one that motivated the questionnaire. Evidence and
// impact are on the ITEM (`item.evidence`, `item.impact`), not in the FormSpec; FormSpec blocks
// alternate "## N. Title + argument" and field, with no preamble before "## 1.".
// One specimen shared by the questionnaire, question screen, recap and receipt stories. The
// product does not import it.
import type { FormSpec } from "../api/inbox.js";

export const AI_2219_BODY =
  "AI-2219 — Round 2: 6 questions (the screen is identified, only the exact display shape is left)";

export const AI_2219_EVIDENCE =
  "Your answer frames the subject. I reread the code with that in mind.\n" +
  "A tool card's subtitle (acme/packages/customers/src/components/workflows/node-cards/node-card-body.tsx:13-29) has exactly three behaviors:\n" +
  "- 0 parameters → nothing at all;\n" +
  '- 2 parameters or more → "5 parameters";\n' +
  "- exactly 1 parameter → `key: value` IF the value is a string / a number / a boolean, otherwise the KEY ALONE.";

export const AI_2219_IMPACT =
  "the exact subtitle text of the workflow editor's tool cards (node-card-body.tsx + tests), " +
  "whether the fix extends to object parameters, the fate of the parameters form, and the level of proof required before merging";

export const AI_2219_ROUND_2: FormSpec = {
  blocks: [
    {
      kind: "markdown",
      text: "## 1. An observation I can't make in your place\n\nIn the editor, select an \"Add tags to ticket\" node and look at the right panel, \"Tool parameters\" section. This is the one fact the code can't settle: if the field exists and contains LaPoste_Colissimo, only the card's display is at fault; if there's no field at all, it's the parameter schema that's empty in the database.",
    },
    {
      kind: "field",
      field: {
        id: "panel_state",
        label: "In the right panel of the tags node, I see…",
        type: "radio",
        required: true,
        options: [
          { id: "filled", label: 'A "tag_names" field that does contain LaPoste_Colissimo' },
          { id: "empty", label: 'A "tag_names" field but empty' },
          { id: "none", label: "No parameter field at all" },
          { id: "later", label: "I don't know / I can't check right now" },
        ],
      },
    },
    {
      kind: "markdown",
      text:
        '## 2. What should the line under the tool name look like?\n\nReal example: tool "Add tags to ticket", parameter `tag_names = ["LaPoste_Colissimo"]`.\n\n' +
        "| Option | Today | What would show |\n|---|---|---|\n| A | `tag_names` | `LaPoste_Colissimo` |\n| B | `tag_names` | `Tag names: LaPoste_Colissimo` |\n| C | `tag_names` | `tag_names: LaPoste_Colissimo` |",
    },
    {
      kind: "field",
      field: {
        id: "line_format",
        label: "What should the line under the tool name look like?",
        type: "radio",
        required: true,
        default: "b",
        hint: 'Keep the "name: value" shape of the other cards; the "Tag names" label is already in the catalog.',
        options: [
          { id: "a", label: "A — values only" },
          { id: "b", label: "B — human label + values" },
          { id: "c", label: "C — raw key + values" },
        ],
      },
    },
    {
      kind: "markdown",
      text: '## 3. And when the tool has several parameters?\n\nToday, from two parameters on, the card just says "5 parameters". Also printing the values, joined on a truncated line, doesn\'t break the layout, but changes the look of every tool card, not just the tag ones.',
    },
    {
      kind: "field",
      field: {
        id: "many_params",
        label: "And when the tool has several parameters?",
        type: "radio",
        required: true,
        default: "keep",
        hint: "Minimal scope for the described bug. Changing every card is a design decision that deserves its own task.",
        options: [
          { id: "keep", label: 'Leave "5 parameters": only fix the faulty case' },
          { id: "all", label: "Show joined, truncated values on every card" },
        ],
      },
    },
    {
      kind: "markdown",
      text: '## 4. Parameters that are objects, not lists\n\n`add_row_gsheet` has a single parameter `row` valued `{"Nom": "Dupont", "Colis": "123"}`: the card displays `row`, nothing else. A single rule would cover them: `Row: Nom = Dupont, Colis = 123`.',
    },
    {
      kind: "field",
      field: {
        id: "objects",
        label: "Parameters that are objects, not lists",
        type: "radio",
        default: "same",
        hint: 'Same defect, same line of code; the ticket\'s "check it for all the integration" is aiming at exactly this.',
        options: [
          { id: "same", label: "Same rule: also display their content" },
          { id: "lists", label: "Lists only for this task" },
        ],
      },
    },
    {
      kind: "markdown",
      text: '## 5. The parameters form, in the right panel\n\nIt prints the raw key as the field label (`tag_names`, `requester_email`…) even though the catalog already ships "Tag names", "Requester email" and a help sentence per parameter. Same underlying defect, different screen, and not what your screenshot shows.',
    },
    {
      kind: "field",
      field: {
        id: "form_labels",
        label: "The parameters form, in the right panel",
        type: "select",
        default: "later",
        hint: "The form touches input (validation, unhandled list type), not just display.",
        options: [
          { id: "same-task", label: "In the same task: fix both screens at once" },
          { id: "later", label: 'Separate task: I\'ll file it under "Later"' },
          { id: "nothing", label: "Do nothing, the raw key is fine in the form" },
        ],
      },
    },
    {
      kind: "markdown",
      text: "## 6. How we prove it's fixed\n\nThe repo's rule (FE-E2E-001) requires an end-to-end Playwright test as soon as an application surface is touched, and only a human can lift that requirement. The E2E suite needs the real stack: an agent in a session can't run it.",
    },
    {
      kind: "field",
      field: {
        id: "proof",
        label: "Lift the E2E requirement: unit and component tests are enough",
        type: "checkbox",
        default: true,
        hint: "The change is a pure formatting function, and the rule requires that the waiver come from you.",
      },
    },
  ],
};
