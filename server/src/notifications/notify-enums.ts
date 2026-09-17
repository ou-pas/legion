// Outbound notification vocabulary, kept apart from the service (13/09): `routes.ts`,
// `inbox.ts` and `notify-text.ts` need the event list. Left in `notify.ts`, `notify-text.ts`
// would import the service that imports it, and `tsPreCompilationDeps` counts type imports:
// the cycle would fail the build.

export type NotifEvent =
  | "goal_completed"
  | "goal_stopped"
  | "gate_waiting" // task in review with a gate: an approval is waiting for you
  | "inbox_question"
  | "dependency_wait" // an agent sleeps on a task (wait_for_task); not a question to handle
  | "quota_pause" // out of quota: the session sleeps until reset (v28) and wakes on its own
  | "task_proposed" // an agent files a task in `later` (propose_task); never assigned or run
  // 10/09: a session reached its turn budget while making progress and restarted on its own for
  // the third time (`sessions/turn-relaunch.ts`). Nothing to do, but three restarts mean more than
  // five hundred turns, the only bound on an uncapped relaunch. Only the third one is announced.
  | "session_relaunched"
  // 14/09: an update suspends the whole fleet to cross its window, and used to do it silently.
  // Once per update, not per session: six sessions put to sleep by one gesture are one fact (the
  // count is in the body). Only pauses the operator did not ask for: `startUpdate` is the only
  // emitter, `pauseForOperator` emits nothing.
  | "system_pause"
  | "task_failed"
  | "repo_push_failed"
  | "pr_created"
  | "pr_merged" // inbound webhook: the PR was merged and the task moved to done on its own
  | "standup";

/** Named events, so no caller carries a literal: `satisfies` fails the build if this object
 *  names an event the union does not know.
 *
 *  The strings are the contract: they go into webhook bodies and each subscription's event list.
 *  Renaming a key is free, renaming a value breaks what is already connected. */
export const NOTIF_EVENT = {
  goalCompleted: "goal_completed",
  goalStopped: "goal_stopped",
  gateWaiting: "gate_waiting",
  inboxQuestion: "inbox_question",
  dependencyWait: "dependency_wait",
  quotaPause: "quota_pause",
  taskProposed: "task_proposed",
  sessionRelaunched: "session_relaunched",
  systemPause: "system_pause",
  taskFailed: "task_failed",
  repoPushFailed: "repo_push_failed",
  prCreated: "pr_created",
  prMerged: "pr_merged",
  standup: "standup",
} as const satisfies Record<string, NotifEvent>;

/** Why the control plane suspended the fleet. One cause today. */
export const PAUSE_CAUSE = { update: "update" } as const;

/** Events the screen offers for subscription. `dependency_wait` and `quota_pause` are emitted,
 *  but nobody subscribes to them by hand. */
export const NOTIF_EVENTS: NotifEvent[] = [
  NOTIF_EVENT.goalCompleted,
  NOTIF_EVENT.goalStopped,
  NOTIF_EVENT.gateWaiting,
  NOTIF_EVENT.inboxQuestion,
  NOTIF_EVENT.taskProposed,
  NOTIF_EVENT.sessionRelaunched,
  NOTIF_EVENT.systemPause,
  NOTIF_EVENT.taskFailed,
  NOTIF_EVENT.repoPushFailed,
  NOTIF_EVENT.prCreated,
  NOTIF_EVENT.prMerged,
  NOTIF_EVENT.standup,
];
