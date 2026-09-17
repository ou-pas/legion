import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "../ui/button.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { RoundFoot } from "./inbox-question-step.js";
import { initialValues, type RoundValues } from "./inbox-round-answers.js";
import { AI_2219_ROUND_2 } from "./inbox-round-fixture.js";
import { InboxRoundRecap } from "./inbox-round-recap.js";
import { splitRound } from "./inbox-round-split.js";
import { INBOX_TEXT } from "./text.js";

const meta = { title: "inbox / InboxRoundRecap" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const T = INBOX_TEXT.questionnaire;
const FIELDS = splitRound(AI_2219_ROUND_2).questions.map((q) => q.field);

function Demo({ values, missing }: { values: RoundValues; missing: number[] }) {
  const [comment, setComment] = useState("");
  return (
    <div className="dsd-sheet dsd-pad">
      <InboxRoundRecap
        fields={FIELDS}
        values={values}
        comment={comment}
        onComment={setComment}
        onEdit={() => {}}
      >
        <RoundFoot
          onPrev={() => {}}
          note={missing.length > 0 ? T.missing(missing) : undefined}
          action={
            <Button
              variant="primary"
              size="md"
              disabled={missing.length > 0}
              leading={<Send size={14} aria-hidden="true" />}
              shortcut={<SubmitShortcut />}
            >
              {T.send(FIELDS.length)}
            </Button>
          }
        />
      </InboxRoundRecap>
    </div>
  );
}

export const Incomplete: Story = {
  name: "one answer missing — dotted amber, sending is blocked and names the question",
  render: function Render() {
    return <Demo values={initialValues(FIELDS)} missing={[1]} />;
  },
};

export const Complete: Story = {
  name: "complete — five recommendations kept, one clean answer, one note under 2",
  render: function Render() {
    return (
      <Demo
        values={{
          ...initialValues(FIELDS),
          panel_state: "filled",
          line_format__note: "if the width holds on mobile",
        }}
        missing={[]}
      />
    );
  },
};

export const Deviations: Story = {
  name: "two recommendations discarded — the pill disappears on those lines",
  render: function Render() {
    return (
      <Demo
        values={{ ...initialValues(FIELDS), panel_state: "none", line_format: "a", proof: false }}
        missing={[]}
      />
    );
  },
};
