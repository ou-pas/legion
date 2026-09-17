// DoD approval button, same label and icon in the composer (right after generation) and on a
// `draft` goal page (catching up later): one gesture, `POST /api/goals/:id/approve`, two places.
import { Target } from "lucide-react";
import { Button } from "../ui/button.js";
import { GOAL_TEXT } from "./text.js";

export function ApproveGoalButton({
  pending,
  onApprove,
}: {
  /** Explicit (`GoalComposer`, `approve.isPending`) to also drive the in-progress label. Absent
   *  (`GoalPage`), the button still spins (`Button` detects the promise returned by `onApprove`,
   *  `ui/busy.ts`) but keeps its idle label, having no state to read. */
  pending?: boolean;
  onApprove: () => void | Promise<unknown>;
}) {
  return (
    <Button variant="primary" leading={<Target size={12} />} loading={pending} onClick={onApprove}>
      {pending ? GOAL_TEXT.composer.approving : GOAL_TEXT.composer.approve}
    </Button>
  );
}
