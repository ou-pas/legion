// Since 07/09 Enter alone no longer sends: only the button and Cmd/Ctrl+Enter do. The button
// recalls it in its tooltip on hover (12/09), no longer in a caption under the field.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import { InboxReplyField } from "./inbox-reply-field.js";

const meta = { title: "inbox / InboxReplyField" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AGENT = { agentName: "senior-dev", choices: null };
const WITH_CHOICES = { agentName: "senior-dev", choices: [{ id: "yes", label: "Yes" }] };

export const Empty: Story = {
  name: "empty — the button says there's nothing to send",
  render: () => (
    <Stack gap={10}>
      <InboxReplyField item={AGENT} pending={false} onSend={() => {}} />
    </Stack>
  ),
};

export const WithChoices: Story = {
  name: 'next to choices — the prompt says "or" in free text',
  render: () => (
    <Stack gap={10}>
      <InboxReplyField item={WITH_CHOICES} pending={false} onSend={() => {}} />
    </Stack>
  ),
};

export const WithoutHint: Story = {
  name: 'no reminder — under a form question, which already says it on "Submit"',
  render: () => (
    <Stack gap={10}>
      <InboxReplyField item={AGENT} pending={false} hint={false} onSend={() => {}} />
    </Stack>
  ),
};

/** The capture attached to the answer (16/09). The field is empty and the button still sends:
 *  "look, the dot is off here" does not always come with a sentence. */
export const WithCapture: Story = {
  name: "a screenshot attached — it's enough, the field can stay empty",
  render: () => (
    <Stack gap={10}>
      <InboxReplyField
        item={AGENT}
        pending={false}
        onSend={() => {}}
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
    </Stack>
  ),
};

export const Sending: Story = {
  name: "sending — nothing goes out again until the server responds",
  render: () => (
    <Stack gap={10}>
      <InboxReplyField item={AGENT} pending onSend={() => {}} />
    </Stack>
  ),
};
