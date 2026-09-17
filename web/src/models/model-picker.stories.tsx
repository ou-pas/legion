// The list, the "+", and the probe's four verdicts. Verdicts go through the presentational
// `ModelVerdict`, which lets them ALL show, including `unverifiable`, which only happens on a
// machine authenticated by subscription alone.
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ModelChoice } from "../api/models.js";
import { Field } from "../ui/form.js";
import { Stack } from "../ui/flex.js";
import { ModelPicker } from "./model-picker.js";
import { ModelVerdict } from "./model-verdict.js";

const meta = { title: "models / ModelPicker" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const model = (id: string, displayName: string, resolves: string | null = null): ModelChoice => ({
  id,
  resolves,
  displayName,
  description: "",
  supportsEffort: true,
  effortLevels: ["low", "medium", "high"],
  supportsAdaptiveThinking: true,
});

const MODELS: ModelChoice[] = [
  model("opus", "Opus", "claude-opus-4-6"),
  model("sonnet", "Sonnet", "claude-sonnet-4-8"),
  model("haiku", "Haiku", "claude-haiku-4-5"),
];

export const InTheList: Story = {
  name: 'in the list — the "+" waits alongside',
  render: function Render() {
    const [value, setValue] = useState("sonnet");
    return (
      <Field label="normal">
        <ModelPicker
          value={value}
          onChange={setValue}
          models={MODELS}
          ariaLabel="Model for normal tasks"
          emptyLabel="project default (sonnet)"
        />
      </Field>
    );
  },
};

export const OpenField: Story = {
  name: "pinned field, open — the cross brings back to the list",
  render: function Render() {
    // A value outside the list opens the field by itself: the state a pinned setting is found
    // in next time.
    const [value, setValue] = useState("claude-opus-4-8");
    return (
      <Field label="complexe">
        <ModelPicker
          value={value}
          onChange={setValue}
          models={MODELS}
          ariaLabel="Model for complex tasks"
          emptyLabel="project default (sonnet)"
        />
      </Field>
    );
  },
};

// The four verdicts, and none is a refusal. The wait tone on "unknown" says "look", not
// "impossible": an id missing from the SDK list has already run (23/08).
export const VerdictListed: Story = {
  name: "verdict · already in the list",
  render: () => <ModelVerdict verdict="listed" />,
};

export const VerdictConfirmed: Story = {
  name: "verdict · confirmed by the API",
  render: () => <ModelVerdict verdict="exists" />,
};

export const VerdictUnknown: Story = {
  name: "verdict · unknown to the API — a warning, not a wall",
  render: () => <ModelVerdict verdict="unknown" detail="404 model_not_found." />,
};

export const VerdictUnverifiable: Story = {
  name: "verdict · unverifiable — subscription only, no API key",
  render: () => <ModelVerdict verdict="unverifiable" />,
};

export const VerdictChecking: Story = {
  name: "verdict · verification in progress",
  render: () => <ModelVerdict checking />,
};

export const AllFour: Story = {
  name: "the four verdicts in a row",
  render: () => (
    <Stack gap={8}>
      <ModelVerdict verdict="listed" />
      <ModelVerdict verdict="exists" />
      <ModelVerdict verdict="unknown" detail="404 model_not_found." />
      <ModelVerdict verdict="unverifiable" />
    </Stack>
  ),
};
