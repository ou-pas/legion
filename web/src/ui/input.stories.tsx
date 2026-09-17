import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack } from "./flex.js";
import { Field, FormRow } from "./form.js";
import { Input, SearchInput, Textarea } from "./input.js";
import { Select } from "./select.js";

const meta = { title: "ui / Input · Textarea · Select" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AGENTS = ["senior-dev", "spec", "reviewer"];

// Enough entries to overflow the list window (--h-scroll-md): the "edge shadows" state, plus
// optgroup headings, absent elsewhere.
const MODEL_HISTORY: [string, string[]][] = [
  [
    "Opus",
    ["claude-opus-4-8", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-opus-4-0"],
  ],
  [
    "Sonnet",
    [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-0",
      "claude-3-7-sonnet",
      "claude-3-5-sonnet",
    ],
  ],
  ["Haiku", ["claude-haiku-4-5", "claude-haiku-3-5", "claude-3-haiku"]],
];

export const NormalAndInvalid: Story = {
  name: "normal / invalid",
  render: () => (
    <Stack gap={10}>
      <FormRow>
        <Field label="Task name">
          <Input value="Fix the Stripe webhook" onChange={() => {}} />
        </Field>
        <Field label="Budget $" error="The budget must be a number.">
          <Input value="twelve" onChange={() => {}} inputMode="decimal" />
        </Field>
      </FormRow>
    </Stack>
  ),
};

export const SizeSm: Story = {
  name: "size sm",
  render: function Render() {
    const [agentSm, setAgentSm] = useState("senior-dev");
    return (
      <Stack gap={10}>
        <FormRow>
          <Field label="Branch">
            <Input size="sm" value="legion/fix-stripe-webhook" onChange={() => {}} />
          </Field>
          <Field label="Agent">
            <Select size="sm" value={agentSm} onChange={(e) => setAgentSm(e.target.value)}>
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
      </Stack>
    );
  },
};

export const SearchEmptyAndFilled: Story = {
  name: "search empty / filled",
  render: function Render() {
    const [empty, setEmpty] = useState("");
    const [filled, setFilled] = useState("stripe");
    return (
      <Stack gap={10}>
        <FormRow>
          <SearchInput value={empty} onValueChange={setEmpty} placeholder="Filter tasks…" />
          <SearchInput value={filled} onValueChange={setFilled} placeholder="Filter tasks…" />
        </FormRow>
      </Stack>
    );
  },
};

export const TextArea: Story = {
  name: "text area",
  render: () => (
    <Stack gap={10}>
      <Field
        label="Request"
        hint="In natural language — the orchestrator derives a Definition of Done from it."
      >
        <Textarea
          value="Replay the failed Stripe webhooks since Monday, then publish a report to /artifacts."
          onChange={() => {}}
        />
      </Field>
    </Stack>
  ),
};

export const SelectInvalid: Story = {
  name: "invalid select",
  render: function Render() {
    const [outDir, setOutDir] = useState("");
    return (
      <Stack gap={10}>
        <Field label="Project" error="No project selected.">
          <Select value={outDir} onChange={(e) => setOutDir(e.target.value)}>
            <option value="">— choose —</option>
            <option value="acme">acme</option>
          </Select>
        </Field>
      </Stack>
    );
  },
};

export const LongListEdgeShadowsGroups: Story = {
  name: "long list — edge shadows, groups",
  render: function Render() {
    const [model, setModel] = useState("claude-sonnet-4-5");
    return (
      <Stack gap={10}>
        <Field
          label="Model"
          hint='The list scrolls: the edge shadow says "there is more," top and bottom.'
        >
          <Select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model (long list)"
          >
            {MODEL_HISTORY.map(([family, ids]) => (
              <optgroup key={family} label={family}>
                {ids.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </Stack>
    );
  },
};
