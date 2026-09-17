// The text of the integrations domain: the Linear Issues screen — the workspace's open issues,
// their filters (assignee, status, team) and the popup that turns one into a Legion task.
//
// Two sentences are CUT by an element: "… files the token under <Code>LINEAR_TOKEN</Code> …".
// They stay cut — gluing them into a single string would remove the `<Code>` and change the
// rendering. The catalog therefore carries both pieces, `before` and `after`.
//
// What is NOT copy does not move: the secret name `LINEAR_TOKEN`, the localStorage keys
// (`issue-filters.ts`) and the `stateType` values stay where they are.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const ISSUES_TEXT = defineText({
  /** The screen: its header, its loading, error and empty states. */
  page: {
    title: "Linear issues",
    refresh: "Refresh",
    // The subtitle lives in the body and not in the header: the refresh button would sit in the
    // middle of it.
    sub: "Open issues of the workspace. Check several to make one grouped goal.",
    loading: "Loading Linear issues…",

    /** The grouped goal: the count is on the SELECTION, not on the displayed list. */
    createGoal: (count: number) => `Create a goal (${count} issues)`,
    goalFailed: "Goal not created",

    // The server names the missing secret: this is an empty state with an exit, not a failure.
    // The gesture changed on 15/09 — you CONNECT Linear instead of making a key there and copying
    // it over — so the door leads to Integrations, and the sentence says one click, not a paste.
    noKeyTitle: "Linear is not connected on this project yet",
    noKeyAction: "Open Integrations",
    noKeyBefore: "Connect Linear from Settings › Integrations: Legion files the token under ",
    noKeyAfter: " and reads the workspace issues.",

    failedTitle: "The Linear issues could not be read",
    failedWhy:
      "The call to the Linear API failed: no issue is shown and no task can be created from this page until it goes through.",
    retry: "Retry",
    /** The other exit from the failure: the button leads to Integrations, where the connection is
     *  checked and reconnected — no longer to Secrets, where there is nothing left to look at for
     *  Linear. */
    checkSecret: "Check the connection",

    emptyTitle: "No open issue",
    emptyWhy: "The Linear workspace has no issue left in triage, backlog, todo or in progress.",
  },

  /** The filter bar — three combinable dimensions, and the emptiness they can produce. */
  filters: {
    assignee: "Assignee",
    status: "Status",
    team: "Team",
    /** The "no constraint" choice, one entry for the three menus. */
    all: "all",
    /** The "ghost filter": a saved value that is no longer in the workspace (someone gone, team
     *  archived, state label renamed) stays visible in the menu — otherwise the bar looks neutral
     *  while it filters, often down to zero. */
    unavailable: "(value unavailable)",
    reset: "Reset the filters",

    emptyTitle: "No issue matches the filters",
    /** Since filtering happens at Linear, this emptiness is an ANSWER and not an unlucky sort:
     *  there is no open issue behind it, not merely none in the loaded batch. */
    emptyWhy:
      "The Linear workspace has no open issue matching this combination. This is not a local sort: the question was put to Linear.",
  },

  /** The registry of displayed issues. */
  list: {
    /** At the cap, the count SAYS so. The window of fifty did not disappear with Linear-side
     *  filtering; it became far less of a nuisance, because you no longer search an arbitrary
     *  batch but a precise question. */
    count: (shown: number, capped: boolean) =>
      capped ? `${shown} issues, the most recently updated` : `${shown} ${plural(shown, "issue")}`,
    label: "Open Linear issues",
    openInLinear: (identifier: string) => `Open ${identifier} in Linear`,
    expandDescription: (identifier: string) => `Show the description of ${identifier}`,
    collapseDescription: (identifier: string) => `Hide the description of ${identifier}`,
    linkedTask: "linked task",
    createTask: "Create a task",
  },

  /** What the Issues screen puts into the quick creation popup (`tasks/quick-task-modal.tsx`).
   *  The FORM labels are no longer here since 06/09: "Cancel", "Create", the field names and the
   *  two checkboxes speak about the task, not about Linear, and they were written word for word
   *  in the Reviews screen catalog. They live in `tasks/text/quick-task.ts`. What stays here is
   *  what names the ORIGIN. */
  create: {
    title: (identifier: string) => `Create a task from ${identifier}`,
    defaultName: (identifier: string, title: string) => `${identifier} — ${title}`,
    /** The brief sent to the agent: the issue description, then its link. */
    brief: (description: string, url: string) => `${description}\n\nLinear issue: ${url}`,
    descriptionBlock: (identifier: string) => `Description of ${identifier}`,
    noDescription: "(no description)",
    hint: (identifier: string) =>
      `On launch, the issue moves to “In Progress” in Linear. The agent will include “Closes ${identifier}” in the PR body — merging will close the issue.`,
  },
});
