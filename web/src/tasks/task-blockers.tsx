// What holds a task back, on screen: its blockers, named, with their status.
//
// Since v44 a task can be blocked by several (the slices of a batch all block the Wiki step). The
// board card says "blocked by N"; this panel says WHICH (breakdown spec, behaviour 8), and the name
// is what makes the wait actionable: open the blocker, finish it or delete it.
//
// The component loads nothing and recomputes no rule: a link means blocked, whatever status is shown
// next to it (unblocking is an event consumed when the blocker is done).
import { Link as RouterLink } from "@tanstack/react-router";
import { Link2Off } from "lucide-react";
import type { TaskBlocker } from "../api/tasks.js";
import { StatusChip } from "../ui/chip.js";
import { Link } from "../ui/link.js";
import { List, ListItem } from "../ui/list.js";
import { Panel, PanelHeader, PanelNote } from "../ui/panel.js";
import { TASK_CHIP } from "./task-status.js";
import { TASK_BLOCKERS_TEXT } from "./text/blockers.js";
import { TASK_TEXT } from "./text/vocabulary.js";

export function TaskBlockersPanel({
  blockers,
  projectId,
}: {
  blockers: readonly TaskBlocker[];
  projectId: string;
}) {
  // Nothing holds most tasks, and an empty "no blockers" card would be noise on each of them.
  if (blockers.length === 0) return null;
  return (
    <Panel>
      <PanelHeader
        icon={<Link2Off size={15} />}
        title={TASK_BLOCKERS_TEXT.title(blockers.length)}
      />
      <PanelNote tone="wait">{TASK_BLOCKERS_TEXT.why}</PanelNote>
      <List label={TASK_BLOCKERS_TEXT.listLabel}>
        {blockers.map((b) => (
          <ListItem
            key={b.id}
            // The TITLE is the link, as in lineage.
            title={
              <Link
                variant="inherit"
                render={(p) => (
                  <RouterLink
                    to="/p/$projectId/tasks/$taskId"
                    params={{ projectId, taskId: b.id }}
                    {...p}
                  />
                )}
              >
                {b.name}
              </Link>
            }
            meta={
              <StatusChip state={TASK_CHIP[b.status]} size="sm">
                {TASK_TEXT.status[b.status]}
              </StatusChip>
            }
          />
        ))}
      </List>
    </Panel>
  );
}
