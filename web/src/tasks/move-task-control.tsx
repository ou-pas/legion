// Move the task: ONE ICON opening the destinations menu (04/09). It used to be a select arming a
// confirm button, two controls and a word in an action bar that only wants gestures. A menu keeps
// the property that mattered: nothing is written by accident on hover or keyboard, picking a menu
// entry is a deliberate click, not a select `onChange` firing on an arrow key.
//
// Labels come from `TASK_PAGE_TEXT.move`, the RULE from `task-moves.ts`, and row RENDERING is shared
// with the collapsed "…" menu since 16/09 (`move-task-menu-items.tsx`): this component only keeps
// its trigger and spinner. Under 640px (decision 2, "launch first" spec) `TaskActionsBar` no longer
// mounts it and its destinations become flat rows of the "…" menu.
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { type Task } from "../api/tasks.js";
import { Menu } from "../ui/menu.js";
import { Spinner } from "../ui/spinner.js";
import { Tooltip } from "../ui/tooltip.js";
import { moveOptions } from "./task-moves.js";
import { MoveTaskMenuItems } from "./move-task-menu-items.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import "./move-task-control.css";

export function MoveTaskControl({
  task,
  onMoved,
  onError,
}: {
  task: Task;
  onMoved: () => void;
  onError: (e: Error) => void;
}) {
  const t = TASK_PAGE_TEXT.move;
  const options = moveOptions(task.status);
  const [saving, setSaving] = useState(false);
  if (options.length === 0) return null;

  return (
    // Icon only (04/09): on hover the tooltip must name the gesture like any other `IconBtn` of the
    // bar (tooltip audit 05/09). `Menu` renders its own `<button>`; `Tooltip` listens on the WRAPPER
    // it adds, so hooking it above works even though its child is not a plain button.
    <Tooltip label={t.field}>
      <Menu
        label={t.field}
        className="move-task-trigger"
        align="start"
        trigger={
          saving ? (
            <Spinner size="sm" label={t.saving} />
          ) : (
            <ArrowRightLeft size={14} aria-hidden="true" />
          )
        }
      >
        <MoveTaskMenuItems
          taskId={task.id}
          destinations={options}
          disabled={saving}
          onMoved={onMoved}
          onError={onError}
          onSavingChange={setSaving}
        />
      </Menu>
    </Tooltip>
  );
}
