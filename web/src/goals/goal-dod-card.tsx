// A goal's Definition of Done: editable while `draft` (the only moment a human can catch a degenerate
// DoD), frozen as a checklist afterwards, since the loop ticks it and rewriting it would change the
// approved contract under it.
//
// The empty case is why this module exists. `POST /api/goals` and `PATCH /api/goals/:id` return
// success + `warning` when generation fails: the goal exists with an empty DoD. The toast lasted a
// few seconds, and the page showed an empty editor without a word, an apparent bug. Here the reason
// STAYS, next to the recovery gesture (`POST /api/goals/:id/regenerate`, written for this case).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { goalsApi, GOAL_STATUS, type DodItem, type GoalDetail } from "../api/goals.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { useToast } from "../ui/toast.js";
import { DodChecklist } from "./dod-checklist.js";
import { DodEditor } from "./dod-editor.js";
import { GOAL_TEXT } from "./text.js";

export function GoalDodCard({
  goal,
  items,
  onChange,
}: {
  goal: GoalDetail;
  /** The DISPLAYED DoD: the server's, or the one the operator is correcting. */
  items: DodItem[];
  onChange: (items: DodItem[]) => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const regenerate = useMutation({
    mutationFn: () => goalsApi.regenerateGoal(goal.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.goal(goal.id) });
      push({ tone: "ok", title: GOAL_TEXT.page.regenerated });
    },
    onError: (e: Error) =>
      push({ tone: "bad", title: GOAL_TEXT.page.regenerateRefused, body: e.message }),
  });

  if (goal.status !== GOAL_STATUS.draft) {
    return (
      <Card title={GOAL_TEXT.page.dodTitle}>
        <DodChecklist items={goal.dod} name={GOAL_TEXT.page.dodGauge} />
      </Card>
    );
  }

  return (
    <Card
      title={GOAL_TEXT.page.dodTitle}
      actions={
        <Button
          leading={<RefreshCw size={13} />}
          loading={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          {GOAL_TEXT.page.regenerate}
        </Button>
      }
    >
      <Stack gap={10}>
        {items.length === 0 ? (
          <Empty variant="panel" title={GOAL_TEXT.page.dodEmpty}>
            {GOAL_TEXT.page.dodEmptyWhy}
          </Empty>
        ) : (
          <Text size="sm" tone="muted">
            {GOAL_TEXT.composer.dodIntro}
          </Text>
        )}
        <DodEditor items={items} onChange={onChange} />
      </Stack>
    </Card>
  );
}
