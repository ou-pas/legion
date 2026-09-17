// The merge state query shared by the verdict and the PR tab: one react-query key per page,
// otherwise two timers run.
//
// Polling policy from the 02/09 feedback. "Not known yet": GitHub computes `mergeable` in the
// background, null meanwhile, and every push to main invalidates its cache, so a day of fifteen
// merges keeps falling back into that window. "Conflicting": while a resolution session works, the
// operator watches THIS chip to know when it pushed. Freezing either on first read gives a screen
// that must be reloaded to tell the truth (hit twice on 02/09).
import { queryOptions } from "@tanstack/react-query";
import { reviewApi } from "../api/review.js";

export const prMergeStatesQuery = (taskId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ["pr-merge-state", taskId] as const,
    queryFn: () => reviewApi.prMergeStates(taskId),
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: (query) => {
      const states = query.state.data;
      if (!states || states.length === 0) return false;
      // PR merged or closed: nothing left to wait for
      if (states.some((m) => m.prState === "merged" || m.prState === "closed")) return false;
      // Unknown merge state: GitHub is computing
      if (states.some((m) => m.mergeState === "unknown")) return 5_000;
      return states.every((m) => m.mergeState === "mergeable") ? false : 10_000;
    },
  });
