import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./chip.js";
import { Disclosure } from "./disclosure.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / Disclosure" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ClosedRareSetting: Story = {
  name: "closed — rare setting",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-narrow">
        <Disclosure summary="Effort and thinking">
          <div className="dsl-quiet">Effort: model default · Thinking: adaptive</div>
        </Disclosure>
      </div>
    </Stack>
  ),
};

export const OpenReadOnlyListWithCount: Story = {
  name: "open — read-only list, with counter",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-narrow">
        <Disclosure
          defaultOpen
          summary={
            <>
              Mounted folders
              <Badge count={2} label="2 mounted folders" />
            </>
          }
        >
          <div className="dsl-quiet">/repos/front/src (read) · /out (write)</div>
        </Disclosure>
      </div>
    </Stack>
  ),
};

export const OpenFlushDenseColumns: Story = {
  name: "open + flush — content flush to the edge (dense columns)",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-narrow">
        <Disclosure defaultOpen flush summary="Effort and thinking">
          <div className="dsl-quiet">Effort: model default · Thinking: adaptive</div>
        </Disclosure>
      </div>
    </Stack>
  ),
};
