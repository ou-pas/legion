// A task's bare address resolves to a view.
//
// `effectiveView` knows what to open when nobody chose: the thread on an interview, the report if
// there is one, else the trace (choice C, 23/08). Here it drives a NAVIGATION rather than a render,
// because a view is an address since slice nav/17.
//
// Not a `beforeLoad`: `/p/x/project` can redirect to `repos` because the target is FIXED. Here
// `hasReport` derives from the SSE stream, which lives in the page, so the decision cannot be made
// before the page mounts.
//
// That is the whole problem this file solves. The stream arrives AFTER the first render: at
// resolution time `hasReport` is still false on EVERY task. A resolution that does not replay would
// pin the page on the trace before knowing a report exists, and choice C would silently die. So the
// address the RESOLUTION set is told apart from the one the OPERATOR asked for: the first can be
// corrected, the second is never touched.
//
// `replace: true` is not decorative: without it, opening a task would take two "back" presses to
// return to the board.
import { useEffect, useRef } from "react";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { effectiveView, viewOfPath, TASK_VIEW_PATH, type TaskView } from "./task-views.js";

export function useResolveTaskView(ctx: {
  /** False when the task does not exist: the page renders its absence, and building a view address
   *  for an id naming nothing would add an error to an error. */
  enabled: boolean;
  interview: boolean;
  hasReport: boolean;
  hasSession: boolean;
}): void {
  const { enabled, interview, hasReport, hasSession } = ctx;
  const { projectId, taskId } = useParams({ from: "/p/$projectId/tasks/$taskId" });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  /** The last view the resolution SET itself. A ref and not state: it must trigger no render, and is
   *  only read INSIDE the effect (reading it during render hits `react(refs)`). */
  const posed = useRef<TaskView | null>(null);

  useEffect(() => {
    const { inside, view } = viewOfPath(pathname, taskId);
    // `inside`: only resolve while the address STILL describes this task. Leaving the page (back
    // button, "← Project" rank, the cross) publishes the new address before this page unmounts, and
    // without this guard the resolution saw "no view" and sent back to the task just left. Measured
    // in Chrome, not inferred.
    if (!enabled || !inside) return;
    // The line carrying the whole behaviour. What the resolution set does not count as a choice, so it
    // may take it back, both ways: when the stream reveals a report (it had set the trace for lack of
    // better), and when what it set stops existing (a session restarts, its report is no longer
    // one). An address the OPERATOR asked for is final: it stays, and the view says what it lacks.
    // Without the distinction, one of the two choices would make "Report" a permanent rank doing
    // nothing when clicked.
    const chosen = view !== undefined && view !== posed.current ? view : undefined;
    // And it must happen BEFORE the `return`. Once the operator has chosen, nothing is set by the
    // resolution any more: otherwise `posed` kept the address from BEFORE the detour, so returning to
    // it read as resolution-set, hence correctable. Measured in Chrome at the 01/09 certification:
    // bare address while running (resolution sets "Trace"), click "Diff", the session ends, click
    // "Trace" → landed on "Report", needing a second click.
    if (chosen !== undefined) posed.current = null;
    const target = effectiveView(chosen, { interview, hasReport, hasSession });
    if (view === target) return;
    posed.current = target;
    // `search: {}`: a `?vue=` pasted in a link already chose the segment. One canonical address per
    // view, otherwise the rail cannot tell which rank to light.
    void navigate({
      to: TASK_VIEW_PATH[target],
      params: { projectId, taskId },
      search: {},
      replace: true,
    });
  }, [pathname, enabled, interview, hasReport, hasSession, navigate, projectId, taskId]);
}
