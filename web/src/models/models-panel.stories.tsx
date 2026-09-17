// The system's Models tab. It queries `/api/models`: in the workshop the context decorator
// answers, so the EMPTY form shows, which must stay readable and is not an error.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelsPanel } from "./models-panel.js";

const meta = { title: "models / ModelsPanel" } satisfies Meta;
export default meta;
type Story = StoryObj;

export const DefaultPanel: Story = {
  name: "the SDK's model list",
  render: () => <ModelsPanel />,
};
