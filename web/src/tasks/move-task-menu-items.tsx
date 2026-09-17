// The "Move to …" rows of a menu, with the same rendering and network call whether they sit in the
// dedicated trigger (`MoveTaskControl`, above 640px) or flat in the collapsed "…" menu (below it,
// decision 2 of the "launch first" spec, 16/09). The RULE, which destinations from which status,
// stays in `task-moves.ts`.
//
// The `ArrowRightLeft` icon repeats on EVERY row: in the "…" menu a row without icon would misalign
// its text (`Menu` has no submenus, and nesting a second floating surface would set a second focus
// trap inside the first).
import { ArrowRightLeft } from "lucide-react";
import { tasksApi, type Task } from "../api/tasks.js";
import { MenuItem } from "../ui/menu.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";

export function MoveTaskMenuItems({
  taskId,
  destinations,
  disabled,
  onMoved,
  onError,
  onSavingChange,
}: {
  taskId: string;
  /** Computed by the caller with `moveOptions(task.status)`, never here, so that "is there any
   *  destination?" (empty group, decision 3) and "which ones" stay a single reading of the rule. */
  destinations: readonly (readonly [Task["status"], string])[];
  disabled?: boolean;
  onMoved: () => void;
  onError: (e: Error) => void;
  /** Only `MoveTaskControl` uses it, to swap its icon for a spinner during the call. The collapsed
   *  "…" menu shows nothing new during a move (decision 5) and already closes on click. */
  onSavingChange?: (saving: boolean) => void;
}) {
  const t = TASK_PAGE_TEXT.move;

  const move = (to: Task["status"]) => {
    onSavingChange?.(true);
    tasksApi
      .setTaskStatus(taskId, to)
      .then(onMoved)
      .catch(onError)
      .finally(() => onSavingChange?.(false));
  };

  return (
    <>
      {destinations.map(([status, label]) => (
        <MenuItem
          key={status}
          icon={<ArrowRightLeft size={14} />}
          disabled={disabled}
          onSelect={() => move(status)}
        >
          {t.confirm(label)}
        </MenuItem>
      ))}
    </>
  );
}
