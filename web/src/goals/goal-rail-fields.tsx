// A goal's RAILS as form fields: budget, max duration, and (editing only) the no-progress iteration
// threshold. Same fields at creation and edit: `checkRails()` rereads them every loop turn.
//
// Values stay STRINGS: an empty field is legitimate ("no cap"), and a `number | null` at the field
// would force every caller to re-translate "empty". `railsPatch` (goal-rails-draft.ts) translates
// once.
import { Field, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { GOAL_TEXT } from "./text.js";

export function GoalRailFields({
  budget,
  hours,
  onBudget,
  onHours,
  noProgress,
  onNoProgress,
}: {
  budget: string;
  hours: string;
  onBudget: (value: string) => void;
  onHours: (value: string) => void;
  /** The no-progress threshold only appears when EDITING: creation keeps the server default, and a
   *  third number to decide before even reading the DoD is noise. */
  noProgress?: string;
  onNoProgress?: (value: string) => void;
}) {
  return (
    <FormRow>
      <Field label={GOAL_TEXT.composer.budget} hint={GOAL_TEXT.composer.budgetHint}>
        <Input inputMode="decimal" value={budget} onChange={(e) => onBudget(e.target.value)} />
      </Field>
      <Field label={GOAL_TEXT.composer.maxHours} hint={GOAL_TEXT.composer.maxHoursHint}>
        <Input inputMode="decimal" value={hours} onChange={(e) => onHours(e.target.value)} />
      </Field>
      {noProgress !== undefined && onNoProgress && (
        <Field label={GOAL_TEXT.edit.noProgress} hint={GOAL_TEXT.edit.noProgressHint}>
          <Input
            inputMode="numeric"
            value={noProgress}
            onChange={(e) => onNoProgress(e.target.value)}
          />
        </Field>
      )}
    </FormRow>
  );
}
