// The preview has neither data nor state: it is a drawing. One story, then; width is checked by
// dragging the workshop frame, and the phone tier lives in the CSS.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelPreview } from "./channel-preview.js";

const meta = { title: "channels / Channel preview (ChannelPreview)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const InItsPane: Story = {
  name: "in its pane — the shape of a channel to come",
  render: () => <ChannelPreview />,
};
