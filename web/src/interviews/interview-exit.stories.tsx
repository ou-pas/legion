// D10's exit gesture. What is checked here: the button is PRESENT, alone in its header; the round
// count and the "no ceiling" promise live in the Interview view (15/09, D4). Never a greyed
// button with a `title`: Chrome and Safari do not show the `title` of a `disabled` element.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "../ui/panel.js";
import { Stack } from "../ui/flex.js";
import { QUESTION } from "../channels/fixtures.js";
import { InterviewExit } from "./interview-exit.js";

const meta = { title: "interviews / InterviewExit" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const NextToTheForm: Story = {
  name: "next to the form — the gesture's real place (D10)",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={8}>
        <Panel>
          <p>{QUESTION.body}</p>
        </Panel>
        <InterviewExit questionId={QUESTION.id} />
      </Stack>
    </div>
  ),
};
