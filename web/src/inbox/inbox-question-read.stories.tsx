// A round's page, FROZEN: this is history. What shows here and nowhere else is the "You set
// aside the recommendation (...)" line. A decision is reread through what it refused, and a
// capture where every answer says "recommended" does not prove the deviation displays.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Caption } from "../ui/text.js";
import { InboxQuestionRead } from "./inbox-question-read.js";
import { AI_2219_ROUND_2 } from "./inbox-round-fixture.js";
import { formFieldsOf } from "./round-shape.js";
import { INBOX_TEXT } from "./text.js";

const meta = { title: "inbox / InboxQuestionRead" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const FIELDS = formFieldsOf(AI_2219_ROUND_2);

/** The real answers of AI-2219's round 2 as they were sent: five followed, one set aside (no. 5),
 *  and one comment for the whole. */
const ANSWERS = {
  panel_state: "filled",
  line_format: "b",
  many_params: "keep",
  objects: "same",
  form_labels: "same-task",
  form_labels__note: "as long as it doesn't grow PR 4",
  proof: true,
  __comment:
    "For 5, fix both screens at once but keep two commits: the review will read separately.",
};

export const Answered: Story = {
  name: "answered — five recommendations followed, one discarded, one comment",
  render: () => <InboxQuestionRead fields={FIELDS} values={ANSWERS} />,
};

export const WithRepo: Story = {
  name: "the session filed a task — the footer says which one",
  render: () => (
    <InboxQuestionRead
      fields={FIELDS}
      values={ANSWERS}
      footer={
        <Caption>
          {`${INBOX_TEXT.question.deposited} `}
          <a href="#tache">W8JrCMr_vT — Display parameter values</a>
        </Caption>
      }
    />
  ),
};

export const ClosedWithoutAnswer: Story = {
  name: "closed with no answer — the session stopped while waiting",
  render: () => (
    // No value: each row stays "to decide", in amber. The question existed and nobody answered;
    // showing it as answered would suggest a decision that was never made.
    <InboxQuestionRead fields={FIELDS} values={{}} />
  ),
};
