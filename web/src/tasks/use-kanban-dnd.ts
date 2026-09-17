// All the board's dnd-kit mechanics: LOCAL column order (recomputed from `board_order` outside a
// drag, reordered optimistically DURING a drag, across and within columns), and the server call on
// drop (`POST /api/tasks/:id/move`, server/src/tasks/task-move.ts) with a visual rollback if the API
// refuses.
//
// `index` in `{status, index}` is 0-based AMONG THE TASKS ALREADY IN THE TARGET COLUMN (moved task
// excluded), exactly the position dnd-kit gives natively in the reordered array: no rank computation
// here.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCorners,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { tasksApi, type TaskSummary } from "../api/tasks.js";
import { qk } from "../queries.js";
import { TASK_STATUS } from "../api/tasks.js";

type Status = TaskSummary["status"];
type Columns = Record<Status, string[]>;

const STATUSES: Status[] = [
  TASK_STATUS.later,
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.done,
];

/** Ascending `board_order` = top of column (server/src/tasks/task-move.ts); id breaks ties for ranks
 *  still equal (v21 backfill, tasks never moved since). */
function buildColumns(tasks: TaskSummary[]): Columns {
  const cols: Columns = { later: [], todo: [], doing: [], review: [], done: [] };
  for (const t of [...tasks].sort(
    (a, b) => a.boardOrder - b.boardOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  ))
    cols[t.status].push(t.id);
  return cols;
}

/** `col:${status}` is the droppable id of the column itself (see `KanbanColumnBody`), the only valid
 *  target over an empty column, where no card can be hit. */
function findContainer(id: string, columns: Columns): Status | null {
  if (id.startsWith("col:")) return id.slice(4) as Status;
  return STATUSES.find((s) => columns[s].includes(id)) ?? null;
}

// The targeted lane is the one UNDER THE CURSOR, not the closest (15/09). `closestCorners` returns
// the closest target without requiring an intersection: at the bottom of a long full-height lane,
// cards of the ORIGIN lane always stay closer than the neighbour lane, even with the cursor on it.
// dnd-kit's documented composition for multiple containers: the cursor first (`pointerWithin`), the
// dragged card rectangle when the cursor falls in a gutter (`rectIntersection`), and
// `closestCorners` as last resort with no cursor at all: the KEYBOARD drag, which only has the card
// rectangle and must keep working.
const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = rectIntersection(args);
  if (rectHits.length > 0) return rectHits;
  return closestCorners(args);
};

export function useKanbanDnd(tasks: TaskSummary[], onError: (message: string) => void) {
  const qc = useQueryClient();
  const [columns, setColumns] = useState<Columns>(() => buildColumns(tasks));
  const [activeId, setActiveId] = useState<string | null>(null);
  // The ORIGIN lane of the current drag, to tint the arrival lane only if it differs (board.md,
  // 15/09). State rather than `snapshotRef`: a ref triggers no render, and the tint must follow hover.
  const [originColumn, setOriginColumn] = useState<Status | null>(null);
  const snapshotRef = useRef<Columns | null>(null);
  // True between the drop and the end of the following react-query invalidation: the `move` round
  // trip is slower than the next render triggered by the end of the drag, so without this guard the
  // resync effect below briefly replays the order from BEFORE the drag (stale cache).
  const pendingRef = useRef(false);

  useEffect(() => {
    if (activeId || pendingRef.current) return;
    setColumns(buildColumns(tasks));
  }, [tasks, activeId]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Mouse and finger are not alike, and a single sensor confused them (13/09).
  //
  // The `PointerSensor` treats both the same: six pixels of movement and the card leaves. On a touch
  // screen six pixels are the START OF A SCROLL: the page scrolled while the card lifted, making the
  // board unusable with a finger (measured on an iPhone 16 on 13/09). dnd-kit's docs name this defect
  // for scrollable lists, and their answer is this sensor pair: touch events can prevent scrolling
  // once a drag has started.
  //
  // With a FINGER it takes a HELD press: 250ms without moving more than 5px, the gesture touch kanbans
  // ask for everywhere, and scrolling stays intact. A handle cannot replace the delay: the card's is
  // invisible until keyboard focus (`.ui-sr`), so it does not exist for a finger.
  //
  // With a MOUSE nothing changes: the whole card is grabbable at once, and the 6px threshold still
  // keeps a plain click from lifting the card for a frame.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    snapshotRef.current = columns; // a reference, not a copy: `columns` is never mutated in place
    const id = String(event.active.id);
    setActiveId(id);
    setOriginColumn(findContainer(id, columns));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId2 = String(active.id);
    const overId = String(over.id);
    if (activeId2 === overId) return;
    setColumns((prev) => {
      const from = findContainer(activeId2, prev);
      const to = findContainer(overId, prev);
      if (!from || !to) return prev;
      const fromItems = prev[from];
      const toItems = prev[to];
      const activeIndex = fromItems.indexOf(activeId2);
      const overIndex = toItems.indexOf(overId);
      if (from === to) {
        if (overIndex === -1 || activeIndex === overIndex) return prev;
        return { ...prev, [from]: arrayMove(fromItems, activeIndex, overIndex) };
      }
      // Insert before/after the hovered card depending on which half the pointer is in: `over.rect`
      // does not move during hover (the fixed card), only `active.rect` follows the pointer. Without
      // this, dragging DOWN always inserts one slot too high (known dnd-kit multi-container pattern).
      const activeRect = active.rect.current.translated;
      const isBelow = activeRect ? activeRect.top > over.rect.top + over.rect.height / 2 : false;
      const insertAt = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : toItems.length;
      return {
        ...prev,
        [from]: fromItems.filter((id) => id !== activeId2),
        [to]: [...toItems.slice(0, insertAt), activeId2, ...toItems.slice(insertAt)],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const id = String(active.id);
    const snapshot = snapshotRef.current;
    snapshotRef.current = null;
    setActiveId(null);
    setOriginColumn(null);

    // The final position was built along the `dragOver`s: here we only confirm a VALID drop happened
    // (`over` not null) and read where `columns` put the card. No recomputation.
    const container = over ? findContainer(id, columns) : null;
    if (!container) {
      if (snapshot) setColumns(snapshot);
      return;
    }

    const index = columns[container].indexOf(id);
    const originalContainer = snapshot ? findContainer(id, snapshot) : null;
    const originalIndex = originalContainer ? snapshot![originalContainer].indexOf(id) : -1;
    if (originalContainer === container && originalIndex === index) return; // nothing moved, no call

    pendingRef.current = true;
    tasksApi
      .moveTask(id, { status: container, index })
      // Awaits the refetch (no `void`): that bounds the window where the resync effect must stay
      // silent (see `pendingRef`).
      .then(() => qc.invalidateQueries({ queryKey: qk.tasks }))
      .catch((e: Error) => {
        if (snapshot) setColumns(snapshot); // immediate visual rollback, without waiting for the network
        onError(e.message);
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }

  function handleDragCancel() {
    if (snapshotRef.current) setColumns(snapshotRef.current);
    snapshotRef.current = null;
    setActiveId(null);
    setOriginColumn(null);
  }

  // The lane to tint: where the card WOULD land now (read from optimistic `columns`, not
  // `useDroppable`'s `isOver`, see decision 4 of the spec), and only if it differs from the origin
  // lane. `null`: nothing to tint, same-column reordering included.
  const tintColumn = useMemo(() => {
    if (!activeId || !originColumn) return null;
    const current = findContainer(activeId, columns);
    return current && current !== originColumn ? current : null;
  }, [activeId, originColumn, columns]);

  return {
    columns,
    taskById,
    sensors,
    collisionDetection,
    tintColumn,
    activeTask: activeId ? taskById.get(activeId) : undefined,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
