// The text of the scheduled tasks screen. The page arrived with PR #50 and its labels hardcoded;
// its own move here, as the folder rule wants. The row, the detail card and the run item have
// joined it since — the accepted debt named below is paid off.
import { defineText } from "../i18n/catalog.js";

export const SCHEDULES_TEXT = defineText({
  title: "Scheduled tasks",
  sub: "Rules that produce work at a fixed time. Times are in UTC.",
  /** The empty state says the gesture, not just the absence: "none" teaches nobody anything. */
  emptyTitle: "No scheduled task",
  emptyBody:
    "A schedule creates a task at a fixed time and hands it to an agent. It joins the queue like any other task.",
  loading: "Loading schedules…",
  failedTitle: "Schedules could not be read",
  listLabel: "Scheduled tasks of the project",
  row: {
    enabled: "Enabled",
    disabled: "Disabled",
    next: (when: string) => `Next: ${when}`,
    noNext: "None",
    last: (when: string) => `Last: ${when}`,
    neverRun: "Never",
    detailsFor: (name: string) => `Details of cron ${name}`,
  },
  detail: {
    createdOn: (when: string) => `Created ${when}`,
    cron: "Cron",
    timezone: "Timezone",
    status: "Status",
    nextRun: "Next run",
    lastRun: "Last run",
    target: "Target",
    agent: (id: string) => `Agent: ${id}`,
    chain: (id: string) => `Chain: ${id}`,
    customPrompt: "Custom prompt",
    historyTitle: (count: number) => `Trigger history (${count})`,
    loadingHistory: "Loading history…",
    errorPrefix: (message: string) => `Error: ${message}`,
    noRuns: "No trigger recorded",
  },
  outcomeSummary: {
    created: (count: number) => `${count} created`,
    disabled: (count: number) => `${count} disabled`,
    missed: (count: number) => `${count} missed`,
    errors: (count: number) => `${count} errors`,
  },
  runItem: {
    task: "Task",
    error: "Error",
  },
  outcomeLabel: {
    "task-created": "Task created",
    "skipped-disabled": "Disabled",
    "skipped-missed": "Missed (server down)",
    error: "Error",
  },
  outcomeDescription: {
    "task-created": "The task was created and added to the queue",
    "skipped-disabled": "This scheduled task was disabled",
    "skipped-missed": "The cron was missed while the server was down — no automatic catch-up",
    error: "An error occurred while creating the task",
  },
  relativeTime: {
    never: "never",
    justNow: "just now",
    minutes: (n: number) => `${n}m ago`,
    hours: (n: number) => `${n}h ago`,
    days: (n: number) => `${n}d ago`,
    weeks: (n: number) => `${n}w ago`,
    months: (n: number) => `${n}mo ago`,
  },
});
