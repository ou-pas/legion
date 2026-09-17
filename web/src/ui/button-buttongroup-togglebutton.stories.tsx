import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { GitMerge, MessageSquare } from "lucide-react";
import { Button, ButtonGroup, ToggleButton } from "./button.js";
import { Row } from "./flex.js";

const meta = { title: "ui / ButtonGroup · ToggleButton" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Group: Story = {
  name: "group",
  render: () => (
    <Row gap={10} wrap>
      <ButtonGroup label="Review decision">
        <Button leading={<GitMerge size={13} />}>Approve and merge</Button>
        <Button leading={<MessageSquare size={13} />}>Request changes</Button>
        <Button variant="quiet">Later</Button>
      </ButtonGroup>
    </Row>
  ),
};

export const PressedReleased: Story = {
  name: "pressed / released",
  render: function Render() {
    const [autoMerge, setAutoMerge] = useState(false);
    const [onlyMine, setOnlyMine] = useState(true);
    return (
      <Row gap={10} wrap>
        <ToggleButton pressed={onlyMine} onPressedChange={setOnlyMine}>
          My tasks
        </ToggleButton>
        <ToggleButton pressed={autoMerge} onPressedChange={setAutoMerge} size="sm">
          Auto merge
        </ToggleButton>
      </Row>
    );
  },
};
