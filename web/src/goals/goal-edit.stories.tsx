// Both goal editors are presentational (no query, no API), which is what makes every state
// showable here without mounting half the application.
//
// What to see: the brief has room (the request is a long text, the orchestrator derives the
// DoD from it), and the rails say why Save does nothing when the input is not a number,
// instead of a silent disabled button.
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../ui/button.js";
import { Row } from "../ui/flex.js";
import { GoalBriefEditor } from "./goal-brief-editor.js";
import { GoalRailsEditor } from "./goal-rails-editor.js";

const meta = { title: "goals / Edit a goal" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NAME = "Harden the payment tunnel";
const REQUEST =
  "No more ghost orders after a declined payment: when the PSP responds with an " +
  "error or doesn't respond at all, the order must not exist in the database, in the " +
  "accounting export, or in the confirmation emails. Ghost orders already created are " +
  "listed and cleaned up.";

export const TheBrief: Story = {
  name: "the brief — name and request, draft only",
  render: function Render() {
    const [open, setOpen] = useState<"idle" | "pending" | null>(null);
    return (
      <Row gap={10} wrap>
        <Button onClick={() => setOpen("idle")}>Edit the brief</Button>
        <Button onClick={() => setOpen("pending")}>Edit the brief (saving)</Button>
        {open && (
          <GoalBriefEditor
            name={NAME}
            request={REQUEST}
            pending={open === "pending"}
            onSave={() => setOpen(null)}
            onClose={() => setOpen(null)}
          />
        )}
      </Row>
    );
  },
};

export const TheRails: Story = {
  name: "the rails — bounded, uncapped, unreadable input",
  render: function Render() {
    const [open, setOpen] = useState<"bornes" | "libres" | null>(null);
    return (
      <Row gap={10} wrap>
        <Button onClick={() => setOpen("bornes")}>Bounded rails ($25, 30 min)</Button>
        <Button onClick={() => setOpen("libres")}>Uncapped rails</Button>
        {open && (
          <GoalRailsEditor
            goal={
              open === "bornes"
                ? { budgetUsd: 25, maxDurationMs: 1_800_000, maxNoProgress: 3 }
                : { budgetUsd: null, maxDurationMs: null, maxNoProgress: 5 }
            }
            onSave={() => setOpen(null)}
            onClose={() => setOpen(null)}
          />
        )}
      </Row>
    );
  },
};
