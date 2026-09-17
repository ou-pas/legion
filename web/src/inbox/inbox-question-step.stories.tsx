import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../ui/button.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { InboxQuestionStep, RoundFoot } from "./inbox-question-step.js";
import { AI_2219_ROUND_2 } from "./inbox-round-fixture.js";
import { splitRound } from "./inbox-round-split.js";
import { INBOX_TEXT } from "./text.js";

const meta = { title: "inbox / InboxQuestionStep" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const T = INBOX_TEXT.questionnaire;
const ROUND = splitRound(AI_2219_ROUND_2);
const question = (i: number) => ROUND.questions[i]!;

function Demo({ i, initial, initialNote }: { i: number; initial?: unknown; initialNote?: string }) {
  const [value, setValue] = useState<unknown>(initial ?? question(i).field.default);
  const [note, setNote] = useState(initialNote ?? "");
  return (
    <div className="dsd-sheet dsd-pad">
      <InboxQuestionStep
        question={question(i)}
        value={value}
        onChange={setValue}
        note={note}
        onNote={setNote}
      >
        <RoundFoot
          onPrev={i > 0 ? () => {} : undefined}
          action={
            <Button variant="primary" size="md" shortcut={<SubmitShortcut />}>
              {T.next}
            </Button>
          }
        />
      </InboxQuestionStep>
    </div>
  );
}

export const Recommended: Story = {
  name: "radio with a recommendation — preselected, labeled, its reason underneath",
  render: function Render() {
    return <Demo i={1} />;
  },
};

export const WithNote: Story = {
  name: "with a note (08/09) — the optional field under the options, filled in",
  render: function Render() {
    return <Demo i={1} initialNote="agreed, only if question 2 follows." />;
  },
};

export const WithoutRecommendation: Story = {
  name: 'radio with no recommendation — nothing checked, no "Previous" on the first',
  render: function Render() {
    return <Demo i={0} />;
  },
};

export const WithTable: Story = {
  name: "argument with a markdown table — the argument is this question's own",
  render: function Render() {
    return <Demo i={1} initial="a" />;
  },
};

export const SelectField: Story = {
  name: "select — the typed field as-is, its hint underneath",
  render: function Render() {
    return <Demo i={4} />;
  },
};

export const Checkbox: Story = {
  name: "checkbox — the title asks the question, the box answers",
  render: function Render() {
    return <Demo i={5} />;
  },
};
