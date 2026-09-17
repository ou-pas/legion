// The machine choice of a task, next to "Run the task again". The third state is why the field
// exists: the chosen machine no longer answers. It stays chosen and choosable, and the reason is
// written next to it: "I see why it does not start" rather than "the button is grey".
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RunnerSummary } from "../api/infra.js";
import { RunnerChoice } from "./runner-choice.js";
import { demoTask } from "./task-fixture.js";

const meta = { title: "tasks / RunnerChoice" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const PARC: RunnerSummary[] = [
  { id: "r-local", name: "local", enabled: true, reachable: true },
  { id: "r-mini", name: "mini-workshop", enabled: true, reachable: true },
  { id: "r-mac", name: "laptop-workshop", enabled: true, reachable: false },
  { id: "r-vieux", name: "old-server", enabled: false, reachable: false },
];

export const None: Story = {
  name: "no machine chosen — the control plane decides, and it reads that way",
  render: () => <RunnerChoice task={demoTask()} runners={PARC} onChosen={() => {}} />,
};

export const Chosen: Story = {
  name: "a machine chosen, and it responds",
  render: () => (
    <RunnerChoice
      task={demoTask({ chosenRunnerId: "r-mini" })}
      runners={PARC}
      onChosen={() => {}}
    />
  ),
};

export const Unreachable: Story = {
  name: "the chosen machine doesn't respond — the reason is right next to it, clearly",
  render: () => (
    <RunnerChoice task={demoTask({ chosenRunnerId: "r-mac" })} runners={PARC} onChosen={() => {}} />
  ),
};

export const Disabled: Story = {
  name: "the chosen machine has been disabled",
  render: () => (
    <RunnerChoice
      task={demoTask({ chosenRunnerId: "r-vieux" })}
      runners={PARC}
      onChosen={() => {}}
    />
  ),
};

export const Deleted: Story = {
  name: "the chosen machine is no longer in the fleet — the select says so instead of showing empty",
  render: () => (
    <RunnerChoice
      task={demoTask({ chosenRunnerId: "r-disparu" })}
      runners={PARC}
      onChosen={() => {}}
    />
  ),
};
