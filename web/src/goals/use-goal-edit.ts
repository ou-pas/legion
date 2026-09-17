// Writing a goal edit: one path for brief and rails, which share the route and the three outcomes.
//
//  · REFUSAL: relayed VERBATIM in a `bad` toast. The server names the status and the frozen field; a
//    screen paraphrase would say it no better and would drift.
//  · SUCCESS: the goal query is invalidated. Changing the request REGENERATES DoD and plan on the
//    server, so keeping the old DoD on screen would show another request's criteria. The project
//    list is invalidated too (it shows the goal name).
//  · WARNING: the edit is saved but the DoD could not be regenerated. Not a failure (nothing is
//    lost), a gesture left to make: `wait` tone, server message as toast body.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { goalsApi, type GoalPatch } from "../api/goals.js";
import { qk } from "../queries.js";
import { useToast } from "../ui/toast.js";
import { GOAL_TEXT } from "./text.js";

const FIELD_NAMES: Record<keyof GoalPatch, string> = GOAL_TEXT.edit.fieldNames;

export function useGoalEdit(goal: { id: string; projectId: string }, onSaved?: () => void) {
  const qc = useQueryClient();
  const { push } = useToast();
  return useMutation({
    mutationFn: (patch: GoalPatch) => goalsApi.editGoal(goal.id, patch),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: qk.goal(goal.id) });
      void qc.invalidateQueries({ queryKey: qk.goals(goal.projectId) });
      if (res.warning) push({ tone: "wait", title: GOAL_TEXT.edit.dodWarning, body: res.warning });
      else if (res.changed.length === 0) push({ tone: "info", title: GOAL_TEXT.edit.unchanged });
      else
        push({ tone: "ok", title: GOAL_TEXT.edit.saved(res.changed.map((f) => FIELD_NAMES[f])) });
      onSaved?.();
    },
    onError: (e: Error) => push({ tone: "bad", title: GOAL_TEXT.edit.refused, body: e.message }),
  });
}
