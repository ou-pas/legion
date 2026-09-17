// AI-2219's round 2, read one question per screen.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FormSpec } from "../api/inbox.js";
import { InboxQuestionnaire } from "./inbox-questionnaire.js";
import { AI_2219_ROUND_2 } from "./inbox-round-fixture.js";

const meta = { title: "inbox / InboxQuestionnaire" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const FullRound: Story = {
  name: 'a round of six questions — rail, one question on screen, the argument without the agent\'s "## 1."',
  render: function Render() {
    return <InboxQuestionnaire spec={AI_2219_ROUND_2} pending={false} onSubmit={() => {}} />;
  },
  parameters: {
    docs: {
      description: {
        story:
          "The first question has no recommendation (\"to decide\"); the following ones have one, preselected and labeled. Moving through screens with ⌘↵ means \"I'll follow you\". The recap is the rail's last entry. The agent's receipt (evidence, impact) isn't here: the inbox entry collapses it above.",
      },
    },
  },
};

export const SingleQuestion: Story = {
  name: "a single question — no rail, no recap: the options, the comment, the send",
  render: function Render() {
    const spec: FormSpec = { blocks: AI_2219_ROUND_2.blocks.slice(2, 4) };
    return <InboxQuestionnaire spec={spec} pending={false} onSubmit={() => {}} />;
  },
};

export const Sending: Story = {
  name: "sending — the button carries the spinner",
  render: function Render() {
    const spec: FormSpec = { blocks: AI_2219_ROUND_2.blocks.slice(3, 4) };
    return <InboxQuestionnaire spec={spec} pending onSubmit={() => {}} />;
  },
};

/** The case that called for attachments (16/09): an interview where the answer IS a capture.
 *  The paperclip lives under the comment, on the screen that sends. */
export const WithCapture: Story = {
  name: "a screenshot attached to the round — under the comment, where you send",
  render: function Render() {
    const spec: FormSpec = { blocks: AI_2219_ROUND_2.blocks.slice(2, 4) };
    return (
      <InboxQuestionnaire
        spec={spec}
        pending={false}
        onSubmit={() => {}}
        attachments={{
          picked: [
            { name: "screenshot-2026-09-16-19-41-05.png", size: 182_400, contentBase64: "AAA=" },
          ],
          refusal: null,
          busy: false,
          add: () => {},
          paste: () => {},
          remove: () => {},
          clear: () => {},
          upload: () => Promise.resolve(),
          uploadThen: (_id, send) => (send(), Promise.resolve()),
        }}
      />
    );
  },
};

export const Mobile: Story = {
  name: "under 900px — the rail moves above, as a scrolling band",
  render: function Render() {
    return <InboxQuestionnaire spec={AI_2219_ROUND_2} pending={false} onSubmit={() => {}} />;
  },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
