import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row } from "./flex.js";
import { Input } from "./input.js";
import { SaveButton } from "./save-button.js";

const meta = { title: "UI/SaveButton" } satisfies Meta;
export default meta;
type Story = StoryObj;

export const Ready: Story = {
  name: "ready — the value changed, the icon waits for the click",
  render: () => <SaveButton dirty saving={false} label="Save the cap" onSave={() => {}} />,
};

export const Saving: Story = {
  name: "in progress — spinner for the duration of the save",
  render: () => <SaveButton dirty saving label="Save the cap" onSave={() => {}} />,
};

export const Failed: Story = {
  name: "failed — the triangle stays, so does the message",
  render: () => (
    <SaveButton
      dirty
      saving={false}
      error="the runner isn't responding"
      label="Save the cap"
      onSave={() => {}}
    />
  ),
};

export const FullCycle: Story = {
  name: "full cycle — type, save, watch the check land",
  render: function Render() {
    const [server, setServer] = useState("2");
    const [draft, setDraft] = useState("2");
    const [saving, setSaving] = useState(false);
    const save = () => {
      setSaving(true);
      setTimeout(() => {
        setServer(draft);
        setSaving(false);
      }, 900);
    };
    return (
      <Row gap={8} align="center">
        <Input
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Value"
        />
        <SaveButton dirty={draft !== server} saving={saving} label="Save the value" onSave={save} />
      </Row>
    );
  },
};
