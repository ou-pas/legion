// Editing a goal's RAILS (budget, max duration, no-progress threshold), opened from the Guardrails
// card, where they are READ: raising a budget you are close to must not mean searching the page.
//
// Available in `draft`, `active` AND `paused`, the server rule (goal-edit.ts): a rail is not an
// instruction to an agent, it is a bound the loop rereads every turn. The component decides nothing:
// it is only mounted when the rule holds.
import { useState } from "react";
import { Save } from "lucide-react";
import type { GoalPatch } from "../api/goals.js";
import { Button } from "../ui/button.js";
import { Spacer, Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { Modal } from "../ui/modal.js";
import { Text } from "../ui/text.js";
import { GoalRailFields } from "./goal-rail-fields.js";
import { railsDraftOf, railsPatch } from "./goal-rails-draft.js";
import { GOAL_TEXT } from "./text.js";

export function GoalRailsEditor({
  goal,
  pending = false,
  onSave,
  onClose,
}: {
  goal: { budgetUsd: number | null; maxDurationMs: number | null; maxNoProgress: number };
  pending?: boolean;
  onSave: (patch: GoalPatch) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => railsDraftOf(goal));
  const patch = railsPatch(draft);

  return (
    <Modal
      title={GOAL_TEXT.edit.railsTitle}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Spacer />
          <Button onClick={onClose}>{GOAL_TEXT.edit.cancel}</Button>
          <Button
            variant="primary"
            leading={<Save size={12} />}
            loading={pending}
            disabled={patch === null}
            onClick={() => {
              if (patch) onSave(patch);
            }}
          >
            {pending ? GOAL_TEXT.edit.saving : GOAL_TEXT.edit.save}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        <Text size="sm" tone="muted">
          {GOAL_TEXT.edit.railsWhy}
        </Text>
        <GoalRailFields
          budget={draft.budget}
          onBudget={(budget) => setDraft({ ...draft, budget })}
          hours={draft.hours}
          onHours={(hours) => setDraft({ ...draft, hours })}
          noProgress={draft.noProgress}
          onNoProgress={(noProgress) => setDraft({ ...draft, noProgress })}
        />
        {/* Why Save is disabled is WRITTEN: a disabled button without a word is a dead end, and a
            `title` does not show on a disabled element. */}
        {patch === null && <FormError>{GOAL_TEXT.edit.badNumber}</FormError>}
      </Stack>
    </Modal>
  );
}
