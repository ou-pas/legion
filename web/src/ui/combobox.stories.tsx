// Choice WITH SEARCH, where a Select runs out. Empty list, loading, search in progress, no result,
// chosen value, and a long list to show scrolling. The last two are never seen while developing:
// one always tests with three entries and an empty value.
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Combobox, type ComboboxOption } from "./combobox.js";
import { Field } from "./form.js";
import { Stack } from "./flex.js";
import { Text } from "./text.js";

const meta = { title: "ui / Combobox" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const MEMBRES: ComboboxOption[] = [
  { id: "", label: "all" },
  { id: "u-1", label: "Alice Martin" },
  { id: "u-2", label: "Bruno Petit" },
  { id: "u-3", label: "Chloé Dubois" },
  { id: "u-4", label: "Damien Roy" },
  { id: "u-5", label: "Élodie Fontaine" },
];

// Twenty-six, the workspace's real headcount measured on 01/09: that's the threshold past which
// a native <select> stops being usable, so it's the one the story has to show.
const VINGT_SIX: ComboboxOption[] = Array.from({ length: 26 }, (_, i) => ({
  id: `u-${i}`,
  label: `${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i]}udrey Person ${i + 1}`,
}));

export const ChosenValue: Story = {
  name: "value selected",
  render: function Render() {
    const [value, setValue] = useState("u-3");
    return (
      <Stack gap={10}>
        <Field label="Assignee">
          <Combobox label="Assignee" options={MEMBRES} value={value} onChange={setValue} />
        </Field>
        <Text tone="muted" size="sm">
          Value: {value === "" ? "(none)" : value}
        </Text>
      </Stack>
    );
  },
};

export const SearchInProgress: Story = {
  name: 'search in progress (type "chl", accents are folded)',
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Stack gap={10}>
        <Field label="Assignee" hint='"chloe" finds "Chloé Dubois" — the search folds accents.'>
          <Combobox label="Assignee" options={MEMBRES} value={value} onChange={setValue} />
        </Field>
      </Stack>
    );
  },
};

export const LongList: Story = {
  name: "long list (26 members, the list scrolls)",
  render: function Render() {
    const [value, setValue] = useState("u-17");
    return (
      <Field label="Assignee">
        <Combobox label="Assignee" options={VINGT_SIX} value={value} onChange={setValue} />
      </Field>
    );
  },
};

export const NoResult: Story = {
  name: "no results",
  render: function Render() {
    // A search that matches nothing: the surface SAYS so, it doesn't close and doesn't render a
    // silent empty list.
    const [value, setValue] = useState("");
    return (
      <Field label="Assignee" hint='Type "zzz": the surface says "No results".'>
        <Combobox label="Assignee" options={MEMBRES} value={value} onChange={setValue} />
      </Field>
    );
  },
};

export const EmptyList: Story = {
  name: "empty list (nothing to offer)",
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Field label="Team">
        <Combobox
          label="Team"
          options={[]}
          value={value}
          onChange={setValue}
          placeholder="no team"
        />
      </Field>
    );
  },
};

export const Loading: Story = {
  name: "loading",
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Field label="Assignee">
        <Combobox label="Assignee" options={[]} value={value} onChange={setValue} loading />
      </Field>
    );
  },
};

export const Sizes: Story = {
  name: "sizes and disabled field",
  render: function Render() {
    const [value, setValue] = useState("u-2");
    return (
      <Stack gap={10}>
        <Field label="Size md">
          <Combobox label="Size md" options={MEMBRES} value={value} onChange={setValue} />
        </Field>
        <Field label="Size sm">
          <Combobox label="Size sm" size="sm" options={MEMBRES} value={value} onChange={setValue} />
        </Field>
        <Field label="Disabled">
          <Combobox label="Disabled" options={MEMBRES} value={value} onChange={setValue} disabled />
        </Field>
      </Stack>
    );
  },
};
