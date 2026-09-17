// What the task page knows and the rail shows: the number of pushed files, as a badge on the "PR"
// rank (04/09, operator request; the Diff rank joined PR on 05/09 and the badge followed).
//
// This is the state lifting `rail-sections.ts` refused, and it is kept deliberately narrow. The
// RANKS stay a pure function of the path: nothing here adds or removes an entry. Only a decoration,
// a number, crosses, through the React Query cache rather than a context: the page is INSIDE the
// Outlet and the rail AROUND it, so a context does not reach up, the cache does. The key is per
// task, so a rail switching task switches number without copying any state.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pushedRepos } from "./session-facts.js";
import { type TimelineEvent } from "./trace-text.js";

export type TaskFacts = {
  /** Files changed by the last session's pushes, all repositories together. */
  files: number;
};

export const taskFactsKey = (taskId: string) => ["task-facts", taskId] as const;

/** Read by the rail. `enabled: false`: the value is never FETCHED, the page writes it; the hook only
 *  subscribes to the cache and rerenders when it changes. */
export function useTaskFacts(taskId: string | undefined): TaskFacts | undefined {
  const { data } = useQuery({
    queryKey: taskFactsKey(taskId ?? ""),
    queryFn: () => null as TaskFacts | null,
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? undefined;
}

/** Written by the page on every trace change. Same derived fact as the verdict (`pushedRepos`): one
 *  derivation, two readers. */
export function usePublishTaskFacts(taskId: string, events: TimelineEvent[]): void {
  const qc = useQueryClient();
  const files = pushedRepos(events).reduce((sum, p) => sum + p.changes, 0);
  useEffect(() => {
    qc.setQueryData<TaskFacts>(taskFactsKey(taskId), { files });
  }, [qc, taskId, files]);
}
