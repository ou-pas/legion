// Editing a Definition of Done before approval: each criterion rewritten by hand, one added if needed.
// Shared by the composer (right after generation) and a `draft` goal page (catching up a degenerate
// DoD created outside the composer): one place that edits a DoD, not two drifting copies.
import { Plus } from "lucide-react";
import { type DodItem } from "../api/goals.js";
import { Button } from "../ui/button.js";
import { Stack } from "../ui/flex.js";
import { Input } from "../ui/input.js";
import { GOAL_TEXT } from "./text.js";

export function DodEditor({
  items,
  onChange,
}: {
  items: DodItem[];
  onChange: (items: DodItem[]) => void;
}) {
  return (
    <Stack gap={10}>
      {items.map((d, i) => (
        <Input
          key={d.id}
          value={d.text}
          aria-label={GOAL_TEXT.composer.criterion(i + 1)}
          onChange={(e) =>
            onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
          }
        />
      ))}
      <div>
        <Button
          leading={<Plus size={12} />}
          onClick={() =>
            onChange([...items, { id: `d${items.length + 1}`, text: "", done: false }])
          }
        >
          {GOAL_TEXT.composer.addCriterion}
        </Button>
      </div>
    </Stack>
  );
}
