// The aligned cell grid of the dense sheet (variant A, 02/09). The slots cell is shown alone in
// its three states: empty ("nobody"), occupied (occupants LINK to their task), full. Then the
// whole grid, as the sheet sees it: four equal-height columns, a rule between cells.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Caption } from "../ui/text.js";
import { Num } from "../ui/num.js";
import { PlacesVital, Vital, Vitals } from "./runner-vitals.js";

const meta = { title: "infra / RunnerVitals" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmptySlots: Story = {
  name: "slots — nobody working",
  render: () => (
    <div className="dsd-narrow">
      <Vitals label="Local runner vitals">
        <PlacesVital running={0} max={2} occupants={[]} />
      </Vitals>
    </div>
  ),
};

export const OccupiedSlots: Story = {
  name: "slots — the occupants are named, and they're links",
  render: () => (
    <div className="dsd-narrow">
      <Vitals label="Local runner vitals">
        <PlacesVital
          running={2}
          max={2}
          occupants={[
            { taskId: "t1", projectId: "prj-legion", label: "Redesign the Runners page" },
            {
              taskId: "t2",
              projectId: "prj-legion",
              label: "Minimal CI on main — a long title overflows in ellipsis",
            },
          ]}
        />
      </Vitals>
    </div>
  ),
};

export const SlotsWithoutKnownProject: Story = {
  name: "slots — project not yet known to the server: text, never a dead link",
  render: () => (
    <div className="dsd-narrow">
      <Vitals label="Server-workshop runner vitals">
        <PlacesVital running={1} max={2} occupants={[{ taskId: "t9", label: "Purge Docker" }]} />
      </Vitals>
    </div>
  ),
};

export const WholeGrid: Story = {
  name: "the full grid — four cells at the same columns",
  render: () => (
    <Vitals label="Server-workshop runner vitals">
      <PlacesVital running={1} max={4} occupants={[{ taskId: "t1", label: "Attachments brief" }]} />
      <Vital label="VM sessions" hint="What the containers consume inside the Docker VM.">
        <span className="ir-vital-figure">
          <Num value={38} suffix="%" />
        </span>
        <Caption tone="subtle">cpu — measured 12s ago</Caption>
      </Vital>
      <Vital label="Machine">
        <span className="ir-vital-figure">
          <Num value={14} suffix="%" />
        </span>
        <Caption tone="subtle">cpu — read over ssh</Caption>
      </Vital>
      <Vital label="VM disk">
        <span className="ir-vital-figure">
          <Num value={47} suffix="%" />
        </span>
        <Caption tone="subtle">60 GB total</Caption>
      </Vital>
    </Vitals>
  ),
};
