// The rail of a multi-screen flow: steps, answers, progress.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Check } from "lucide-react";
import { StepRail, StepRailDivider, StepRailItem } from "./step-rail.js";

const meta = { title: "ui / StepRail" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const STEPS = [
  {
    title: "What you see in the right panel",
    sub: 'A "tag_names" field that contains LaPoste_Colissimo',
    done: true,
  },
  { title: "Subtitle shape for a list", sub: "B — human label + values", done: true },
  { title: "Several parameters", sub: "to decide", done: false },
  { title: "Object-type parameters", sub: "recommended: same rule", done: false },
];

function Demo({ initial }: { initial: number }) {
  const [current, setCurrent] = useState(initial);
  return (
    <div className="dsd-narrow">
      <StepRail
        label="Steps"
        heading={`${STEPS.length} questions, then send`}
        progress={{ value: current + 1, max: STEPS.length + 1, label: "Progress" }}
      >
        {STEPS.map((s, i) => (
          <StepRailItem
            key={s.title}
            index={i + 1}
            title={s.title}
            sub={s.sub}
            done={s.done}
            current={current === i}
            onSelect={() => setCurrent(i)}
          />
        ))}
        <StepRailDivider />
        <StepRailItem
          index={<Check size={13} aria-hidden="true" />}
          title="Review and send"
          sub="review, comment, send"
          current={current === STEPS.length}
          onSelect={() => setCurrent(STEPS.length)}
        />
      </StepRail>
    </div>
  );
}

export const InProgress: Story = {
  name: "in progress — two answered, the third current, the fourth recommended",
  render: function Render() {
    return <Demo initial={2} />;
  },
};

export const AtRecap: Story = {
  name: "at the final step — the gauge is full and turns green",
  render: function Render() {
    return <Demo initial={STEPS.length} />;
  },
};

export const Narrow: Story = {
  name: "long labels — the subtitle wraps, the rail doesn't widen",
  render: function Render() {
    return (
      <div className="dsd-narrow">
        <StepRail label="Steps" progress={{ value: 1, max: 3, label: "Progress" }}>
          <StepRailItem
            index={1}
            current
            title="A question whose label runs onto two lines without truncating"
            sub="Provide a PHP environment in the session so I can scaffold pest/phpunit and write a real, verified test"
            onSelect={() => {}}
          />
          <StepRailItem index={2} title="Short" sub="to decide" onSelect={() => {}} />
        </StepRail>
      </div>
    );
  },
};
