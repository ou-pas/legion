// Board column body: dnd-kit drop zone (`useDroppable`, the whole column, empty included) and the
// ordered list (`SortableContext`) of its cards. Split from Board.tsx so the drop hook is set once
// per column, never recreated per card.
import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type Session } from "../api/sessions.js";
import { type TaskSummary } from "../api/tasks.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { SortableTaskCard } from "./sortable-task-card.js";

export function KanbanColumnBody({
  status,
  taskIds,
  taskById,
  sessionByTaskId,
  agentNameByTaskId,
  emptyTitle,
  emptyWhy,
  renderActions,
}: {
  status: TaskSummary["status"];
  /** Ids in DISPLAY order: ascending `board_order` outside a drag, reordered locally (optimistic)
   *  during a drag by `Board.tsx`'s event handler. */
  taskIds: string[];
  taskById: Map<string, TaskSummary>;
  sessionByTaskId: Map<string, Session>;
  agentNameByTaskId: Map<string, string>;
  emptyTitle: string;
  /** A sentence stating a CAUSE `emptyTitle` does not already carry (D5). Absent for most columns,
   *  whose empty title is enough. */
  emptyWhy?: string;
  renderActions: (task: TaskSummary) => ReactNode;
}) {
  // The column id (`col:${status}`) IS its droppable: a drag over an empty column (no card to hit)
  // must still find a target, see `findContainer` in Board.tsx which recognises the prefix.
  // This Stack is also the direct child of an `Inset stretch` (Board.tsx): `ui/inset.css` stretches
  // it to the remaining height of the frame, so the drop zone covers the whole lane and not just its
  // cards (board.md, 15/09). Stretching is `ui/`'s job, not this domain module's.
  const { setNodeRef } = useDroppable({ id: `col:${status}` });
  return (
    <Stack ref={setNodeRef} gap={8}>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        {taskIds.map((id) => {
          const task = taskById.get(id);
          if (!task) return null; // race with a react-query invalidation, gone on the next render
          return (
            <SortableTaskCard
              key={id}
              task={task}
              session={sessionByTaskId.get(id)}
              agentName={agentNameByTaskId.get(id)}
              actions={renderActions(task)}
            />
          );
        })}
      </SortableContext>
      {/* Stacked, icon above text (operator feedback, 04/09): a kanban column is narrow, and the
          icon on the left ate half of the text width. */}
      {taskIds.length === 0 && (
        <Empty variant="panel" title={emptyTitle}>
          {emptyWhy}
        </Empty>
      )}
    </Stack>
  );
}
