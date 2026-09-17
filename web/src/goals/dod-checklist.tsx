// A goal's Definition of Done: progress, ticked criteria, and the done state. Used on the goal page,
// the goal list and the composer, built on ProgressBar + List.
import { Circle, CircleCheck } from "lucide-react";
import { type DodItem } from "../api/goals.js";
import { StatusChip } from "../ui/chip.js";
import { List, ListRow } from "../ui/list.js";
import { ProgressBar } from "../ui/meter.js";
import { Num } from "../ui/num.js";
import { Text } from "../ui/text.js";
import { GOAL_TEXT } from "./text.js";
import "./dod-checklist.css";

export function DodChecklist({
  items,
  name = GOAL_TEXT.dod.defaultName,
  className,
}: {
  items: DodItem[];
  /** The gauge's accessible name, e.g. "DoD — Harden the payment funnel". */
  name?: string;
  className?: string;
}) {
  const done = items.filter((d) => d.done).length;
  const complete = items.length > 0 && done === items.length;
  return (
    <div className={["dm-dod", className].filter(Boolean).join(" ")}>
      <ProgressBar
        name={name}
        value={done}
        max={items.length}
        size="lg"
        valueText={GOAL_TEXT.dod.progress(done, items.length)}
        valueLabel={
          complete ? (
            <StatusChip state="ok" size="sm" dot={false}>
              {GOAL_TEXT.dod.complete}
            </StatusChip>
          ) : (
            <Num value={`${done} / ${items.length}`} />
          )
        }
      />
      <List as="ul" density="compact" label={name}>
        {items.map((d) => (
          <ListRow
            key={d.id}
            as="li"
            className={d.done ? "dm-dod-item dm-dod-item-done" : "dm-dod-item"}
            leading={
              d.done ? (
                <CircleCheck size={14} className="dm-dod-mark" aria-hidden="true" />
              ) : (
                <Circle size={14} className="dm-dod-mark" aria-hidden="true" />
              )
            }
          >
            <span className="dm-dod-sr">
              {d.done ? GOAL_TEXT.dod.itemDone : GOAL_TEXT.dod.itemTodo}
            </span>
            <Text size="sm" tone={d.done ? "muted" : "default"}>
              {d.text}
            </Text>
          </ListRow>
        ))}
      </List>
    </div>
  );
}
