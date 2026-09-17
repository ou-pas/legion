// The hint on the eight buttons submitting with Cmd/Ctrl+Enter. Its states on `Button` (primary,
// default, disabled, `loading`) are in `ui/button.stories.tsx` ("with shortcut"); here, the
// component alone.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row } from "./flex.js";
import { SubmitShortcut } from "./submit-shortcut.js";

const meta = { title: "ui / SubmitShortcut" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Alone: Story = {
  name: "alone — [⌘][↩] on Mac, [Ctrl][↵] elsewhere (ui/platform.ts)",
  render: () => (
    <Row gap={10} wrap>
      <SubmitShortcut />
    </Row>
  ),
};
