// A sortable TaskCard (dnd-kit) on the board. No visible handle: the WHOLE card is the drag surface
// (decision 23/08: opening is the frequent gesture, moving the rare one, so shrinking the click to a
// handle would have penalised it). Only the GESTURE listeners (`onMouseDown`, `onTouchStart`) go on
// the wrapper, never `attributes`: the card is a `<Link>`, and dnd-kit's `tabIndex`/`role` would
// nest a focusable inside another, two Tab stops for one object, and a keyboard unable to reach the
// link itself.
// The keyboard is still served: a handle invisible until focus (`.ui-sr` recipe, see
// sortable-task-card.css) carries `attributes` + `listeners.onKeyDown` on `setActivatorNodeRef`,
// dnd-kit's documented handle pattern. Tab reaches it right after the link; Space then arrows move.
import type { KeyboardEventHandler, MouseEventHandler, ReactNode, TouchEventHandler } from "react";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Session } from "../api/sessions.js";
import { type TaskSummary } from "../api/tasks.js";
import { DropIndicator } from "../ui/drop-indicator.js";
import { GOAL_MARK, TaskCard } from "./task-card.js";
import { BOARD_TEXT } from "./text/board.js";
import "./sortable-task-card.css";

export function SortableTaskCard({
  task,
  session,
  agentName,
  actions,
}: {
  task: TaskSummary;
  session?: Session;
  agentName?: string;
  actions?: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  // dnd-kit `listeners` is a `Record<string, Function>` with no signature to spread on a typed React
  // prop. Only the two gesture activators are taken, one per sensor: this is exactly where "only
  // gesture listeners go on the wrapper" is enforced, not a typing convenience. Two since 13/09: the
  // `PointerSensor` was replaced by a mouse/touch pair (see `use-kanban-dnd.ts`), because a pixel
  // threshold cannot tell the start of a drag from the start of a finger scroll.
  const onMouseDown = listeners?.onMouseDown as MouseEventHandler<HTMLDivElement> | undefined;
  const onTouchStart = listeners?.onTouchStart as TouchEventHandler<HTMLDivElement> | undefined;
  const onKeyDown = listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined;

  return (
    <div
      ref={setNodeRef}
      className="ui-sortable-card"
      data-dragging={isDragging ? "true" : undefined}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      // oxlint-disable-next-line react/forbid-dom-props -- card position during the drag, computed frame by frame by dnd-kit (never a design value)
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
    >
      <div className="ui-sortable-card-content">
        <TaskCard task={task} session={session} agentName={agentName} actions={actions} />
      </div>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="ui-sortable-card-handle"
        aria-label={BOARD_TEXT.dragTask(task.name.replace(GOAL_MARK, ""))}
        {...attributes}
        onKeyDown={onKeyDown}
      >
        <GripVertical size={13} aria-hidden="true" />
        {BOARD_TEXT.dragHandle}
      </button>
      {isDragging && <DropIndicator />}
    </div>
  );
}

/** The clone following the pointer (`DragOverlay`): same card, raised. Rendered apart from
 *  `SortableTaskCard` because `DragOverlay` portals its child out of the board tree, so it neither
 *  needs nor may use the `useSortable` refs and listeners. */
export function DraggedTaskCard({
  task,
  session,
  agentName,
}: {
  task: TaskSummary;
  session?: Session;
  agentName?: string;
}) {
  return (
    <div className="ui-sortable-card-overlay">
      <TaskCard task={task} session={session} agentName={agentName} />
    </div>
  );
}
