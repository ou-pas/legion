// Where a notification leads. Pure rules: no database, no network.
//
// Push used to open the root whatever the event, leaving the operator to find by hand what they
// had just been told about. The payload already carries the project (added by `notifyOut`) and
// the task.
//
// It never guesses: without a project or a task it returns the root. A half-built URL would open
// an error screen, which is worse than landing home.
import { NOTIF_EVENT, type NotifEvent } from "./notify-enums.js";

/** The path a notification opens. Always absolute, always served by the screen. */
export function notifTarget(event: NotifEvent, payload: Record<string, unknown>): string {
  const project = str(payload.projectId);
  const task = str(payload.taskId);
  if (!project) return "/";
  if (!task) return `/p/${project}/board`;

  switch (event) {
    // What waits for an answer opens the channel, where the question sits with its buttons; the
    // task page would cost one more click.
    case NOTIF_EVENT.inboxQuestion:
    case NOTIF_EVENT.dependencyWait:
    case NOTIF_EVENT.quotaPause:
      return `/p/${project}/channels/${task}`;

    // A gate is judged on the diff, which the PR view shows: approving without reading it is what
    // the gate exists to prevent.
    case NOTIF_EVENT.gateWaiting:
    case NOTIF_EVENT.prCreated:
    case NOTIF_EVENT.prMerged:
      return `/p/${project}/tasks/${task}/pr`;

    // A failure is read in the trace: the task page says that it failed, the trace says where.
    case NOTIF_EVENT.taskFailed:
    case NOTIF_EVENT.repoPushFailed:
      return `/p/${project}/tasks/${task}/timeline`;

    default:
      return `/p/${project}/tasks/${task}`;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
