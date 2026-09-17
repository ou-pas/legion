// A task's views: which exist, where they live, which one opens.
//
// Nine tabs became ten addresses (slice nav/17). A tab is not an address: you cannot send a link to a
// task's diff, come back to it with "back", or name the view in the browser title.
//
// Ids ARE the path segments, literally. `?vue=diff` has been in URLs since slice 06, so in bookmarks
// and messages: the mapping to `/tasks/<id>/diff` is the identity, with no table to maintain, hence
// none that can lie. `criteria` is the only new id: the criteria panel was never a tab.

/** The views. `undefined` on the choice side means nobody has chosen yet.
 *
 *  "Diff" is no longer a view (05/09, operator decision on mock-up `direction-pr-diff.html`, variant
 *  A): the diff is read INSIDE the PR view, under the draft, like a GitHub page. The `/diff` segment
 *  was removed (nav work, batch G, 12/09); `?vue=diff` is still accepted through
 *  `RETIRED_TASK_VIEWS` below, for links already pasted in messages.
 *
 *  "Settings" is no longer a view either (batch G, 12/09): a task's settings live in the page's right
 *  panel (`tasks/task-inspector.tsx`) since 04/09, and the `/settings` route only duplicated it. */
export type TaskView =
  | "interview"
  | "report"
  | "timeline"
  | "brief"
  | "criteria"
  | "artifacts"
  | "pr"
  | "notes";

/** The values a legacy `?vue=` accepts, the very ones the screen already names. */
export const TASK_VIEWS: readonly TaskView[] = [
  "interview",
  "report",
  "timeline",
  "brief",
  "criteria",
  "artifacts",
  "pr",
  "notes",
];

/** A `?vue=` or segment from BEFORE the views merge, and the view serving it today. */
export const RETIRED_TASK_VIEWS: Readonly<Record<string, TaskView>> = { diff: "pr" };

/** Each view's path, in a single copy, read by the rail (`projects/rail-sections.ts`), the router and
 *  the page navigation. Two lists would drift, and the rail would point at a route nobody serves:
 *  the defect `make contract` catches for the API and nothing catches for navigation.
 *
 *  `as const`: TanStack Router types its links on path literals, so a wide `string` would lose the
 *  check exactly where it matters. */
export const TASK_VIEW_PATH = {
  interview: "/p/$projectId/tasks/$taskId/interview",
  report: "/p/$projectId/tasks/$taskId/report",
  timeline: "/p/$projectId/tasks/$taskId/timeline",
  brief: "/p/$projectId/tasks/$taskId/brief",
  criteria: "/p/$projectId/tasks/$taskId/criteria",
  artifacts: "/p/$projectId/tasks/$taskId/artifacts",
  pr: "/p/$projectId/tasks/$taskId/pr",
  notes: "/p/$projectId/tasks/$taskId/notes",
} as const satisfies Record<TaskView, string>;

/** A view received from outside: a URL segment, a legacy `?vue=`.
 *
 *  MISSING or UNKNOWN yields `undefined`, never an error: a URL is typed, truncated and pasted by
 *  humans, and a page refusing to open because a parameter lost its end punishes sharing.
 *  `undefined` falls back through `effectiveView`. */
export function parseTaskView(value: unknown): TaskView | undefined {
  const retired = typeof value === "string" ? RETIRED_TASK_VIEWS[value] : undefined;
  return retired ?? TASK_VIEWS.find((v) => v === value);
}

/** Where we are, seen from a task page. A PURE function of the path, like `railSectionOf` and
 *  `railRowsFor`: "which view is open" has one answer per URL, and a regex is testable without a
 *  router.
 *
 *  `inside` first answers "does this path still describe THIS task?", and not rhetorically. During a
 *  navigation LEAVING the page, the router publishes the new address while the old page is still
 *  mounted for a render. Without this guard the resolution read "no view" on the board path and sent
 *  back to the task: "back" returned where you had just left. Measured in Chrome, not inferred.
 *
 *  `view` stays `undefined` on the bare address, where no view is chosen yet. */
const TASK_PATH = /^\/p\/[^/]+\/tasks\/([^/]+)(?:\/([^/]+))?/;

export function viewOfPath(
  pathname: string,
  taskId: string,
): {
  inside: boolean;
  view: TaskView | undefined;
} {
  const m = TASK_PATH.exec(pathname);
  if (!m || m[1] !== taskId) return { inside: false, view: undefined };
  return { inside: true, view: parseTaskView(m[2]) };
}

/** The report: the agent's LAST text. On a finished session it is its delivery summary, the block
 *  that used to drown the trace. It only exists once the session is over: while running, the last
 *  text is a progress update, not a summary. */
export function agentReport(
  events: readonly { type: string; data: Record<string, unknown> }[],
  ctx: { hasSession: boolean; active: boolean },
): { text: string; available: boolean } {
  const last = [...events]
    .reverse()
    .find((e) => e.type === "text" && String(e.data.text ?? "").trim().length > 0);
  const text = last ? String(last.data.text) : "";
  return { text, available: Boolean(ctx.hasSession && !ctx.active && text) };
}

/** The view actually shown: the one the operator asked for, or the default.
 *
 *  Default: with no session ever run, the BRIEF, the contract one wants to read first. On an interview
 *  task with a session, the THREAD, the conversation that IS the work. Otherwise the report if there
 *  is one, else the raw trace (choice C, 23/08: the page first answers "what happened?").
 *
 *  It lives in the page and not a `beforeLoad`: `/p/x/project` can redirect to `repos` because the
 *  target is fixed, here it is not (`hasReport` derives from the SSE stream). It drives a navigation
 *  with `replace: true` rather than a render.
 *
 *  It lost a clause when views became routes (slice nav/17). It also handled a chosen view that STOPS
 *  existing (the report when a session restarts, the thread when the task is no longer an interview)
 *  by falling back on the default itself. That case is now handled one level UP, in
 *  `use-task-view.ts`, which knows WHO set the address. Rail ranks are STATIC now, and a click on
 *  "Report" silently sending to "Trace" would be a broken rank: the validated mock-up promises ranks
 *  fade instead of disappearing. A view the operator ASKED for stays and says what it lacks; one the
 *  RESOLUTION set is taken back. */
export function effectiveView(
  chosen: TaskView | undefined,
  ctx: { interview: boolean; hasReport: boolean; hasSession: boolean },
): TaskView {
  if (chosen !== undefined) return chosen;
  if (!ctx.hasSession) return "brief";
  return ctx.interview ? "interview" : ctx.hasReport ? "report" : "timeline";
}
