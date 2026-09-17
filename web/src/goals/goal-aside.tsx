// A goal's right column: guardrails, request, and the two gestures editing them. One module because
// both edits share a route, a refusal toast and an invalidation.
//
// Each gesture only appears where the SERVER accepts it (goal-edit.ts): the brief only in `draft`,
// the rails until the goal ends. A button leading to a 409 is a trap; an absent one is not.
import { useState } from "react";
import { Pencil, SlidersHorizontal } from "lucide-react";
import { RAIL_EDITABLE_GOAL_STATUSES, GOAL_STATUS, type GoalDetail } from "../api/goals.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Row, Stack } from "../ui/flex.js";
import { Inset } from "../ui/inset.js";
import { Prose } from "../ui/prose.js";
import { GoalBriefEditor } from "./goal-brief-editor.js";
import { GoalRailsEditor } from "./goal-rails-editor.js";
import { Guardrails } from "./guardrails.js";
import { useGoalEdit } from "./use-goal-edit.js";
import { GOAL_TEXT } from "./text.js";

export function GoalAside({ goal, elapsedMs }: { goal: GoalDetail; elapsedMs: number }) {
  const [editing, setEditing] = useState<"brief" | "rails" | null>(null);
  const edit = useGoalEdit(goal, () => setEditing(null));
  const railsEditable = RAIL_EDITABLE_GOAL_STATUSES.includes(goal.status);
  const briefEditable = goal.status === GOAL_STATUS.draft;

  return (
    // Both gestures live IN the card body, each under what it edits, not in the header: the column
    // is 280 px, and a button there wrapped the card title onto two lines (46 px, measured).
    <Card title={GOAL_TEXT.page.guardrails}>
      <Stack gap={12}>
        <Guardrails
          spentUsd={goal.spentUsd}
          budgetUsd={goal.budgetUsd}
          elapsedMs={elapsedMs}
          maxDurationMs={goal.maxDurationMs}
          noProgressStreak={goal.noProgressStreak}
          maxNoProgress={goal.maxNoProgress}
          iterations={goal.iterations}
          plannedSteps={goal.plan.length}
        />
        {railsEditable && (
          <Row gap={6}>
            <Button leading={<SlidersHorizontal size={13} />} onClick={() => setEditing("rails")}>
              {GOAL_TEXT.edit.rails}
            </Button>
          </Row>
        )}
        <Inset label={GOAL_TEXT.page.request}>
          <Prose size="sm" tone="muted" width="full">
            {goal.request}
          </Prose>
        </Inset>
        {/* Same for the brief: under the text it edits, never in the page action bar, next to
            approval and the kill switch, which have nothing to do with writing a brief. */}
        {briefEditable && (
          <Row gap={6}>
            <Button leading={<Pencil size={13} />} onClick={() => setEditing("brief")}>
              {GOAL_TEXT.edit.brief}
            </Button>
          </Row>
        )}
      </Stack>
      {editing === "brief" && (
        <GoalBriefEditor
          name={goal.name}
          request={goal.request}
          pending={edit.isPending}
          onSave={(patch) => edit.mutate(patch)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing === "rails" && (
        <GoalRailsEditor
          goal={goal}
          pending={edit.isPending}
          onSave={(patch) => edit.mutate(patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
