// A goal list ROW: name, numeric progress, state. No action on the row (decision D11): it leads to
// the goal page, nothing else.
import { Link as RouterLink } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { type Goal } from "../api/goals.js";
import { Chip, StatusChip } from "../ui/chip.js";
import { Link } from "../ui/link.js";
import { ListItem } from "../ui/list.js";
import { Num } from "../ui/num.js";
import { GOAL_CHIP } from "./goal-status.js";
import { GOAL_TEXT } from "./text.js";

export function GoalRow({ goal }: { goal: Goal }) {
  const done = goal.dod.filter((d) => d.done).length;
  return (
    // The design system <Link> delegates to TanStack's <Link>, and the row keeps its ListItem geometry.
    <Link
      variant="inherit"
      render={(p) => (
        <RouterLink
          to="/p/$projectId/goals/$goalId"
          params={{ projectId: goal.projectId, goalId: goal.id }}
          {...p}
        />
      )}
    >
      <ListItem
        interactive
        leading={<Target size={15} />}
        title={goal.name}
        sub={
          <>
            {GOAL_TEXT.list.dod} <Num value={`${done}/${goal.dod.length}`} /> ·{" "}
            <Num value={goal.iterations} /> {GOAL_TEXT.list.iterations(goal.iterations)}
            {goal.budgetUsd !== null && (
              <>
                {" · "}
                <Num value={goal.spentUsd.toFixed(2)} prefix="$" /> /{" "}
                <Num value={goal.budgetUsd.toFixed(2)} prefix="$" />
              </>
            )}
          </>
        }
        meta={
          <>
            {goal.mock && <Chip size="sm">{GOAL_TEXT.mock}</Chip>}
            <StatusChip state={GOAL_CHIP[goal.status]}>{goal.status}</StatusChip>
          </>
        }
      />
    </Link>
  );
}
