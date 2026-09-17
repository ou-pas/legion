// The one-line summary of an outbound notification. Pure rules: no database, no network.
//
// `notifyOut` POSTs `{event, payload, ts}`, the right contract for a programmatic webhook, but
// the same notification ends up on a lock screen where a JSON blob says nothing. This sentence
// serves the push title, the Discord message body and the webhook header alike.
//
// The tone is the product's: a fact, not an invitation. "3 turns without a commit", not "your
// session seems stuck".
import { NOTIF_EVENT, PAUSE_CAUSE, type NotifEvent } from "./notify-enums.js";

/** An HTTP header only carries latin-1 bytes: a task name with an emoji or Japanese would make
 *  undici's `fetch` throw, and the notification would be lost over one character. The JSON body
 *  keeps the name intact. C1 bytes (0x7F-0x9F) go too: control characters are refused in a
 *  header value. */
export function headerSafe(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "").slice(0, 200) || "Legion";
}

/** The subject's name, whichever field the emitter used: `task`, `taskName` and `name` have
 *  always coexisted. */
function subject(p: Record<string, unknown>): string {
  for (const key of ["task", "taskName", "name"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "unnamed";
}

function count(p: Record<string, unknown>, key: string): number {
  const v = p[key];
  return typeof v === "number" ? v : 0;
}

/** "1 session", "3 sessions". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The standup one-liner, kept out of `summarizeNotif` to hold its complexity down. */
function standupSummary(p: Record<string, unknown>): string {
  return `Standup · ${plural(count(p, "gatesWaiting"), "gate")}, ${plural(count(p, "inboxOpen"), "question")}`;
}

/** Why the control plane suspended the fleet. One cause today, named anyway: a system pause
 *  without a cause would say less than a `log.info`. */
function cause(p: Record<string, unknown>): string {
  if (p.cause !== PAUSE_CAUSE.update) return "unknown cause";
  const version = typeof p.version === "string" && p.version.trim() ? ` to ${p.version}` : "";
  return `update${version}`;
}

/** The sentence a human reads on their phone. Never empty: an event with no named case returns
 *  its own name, which is more readable than nothing and noticed at once. */
export function summarizeNotif(event: NotifEvent, payload: Record<string, unknown>): string {
  const name = subject(payload);
  switch (event) {
    case NOTIF_EVENT.gateWaiting:
      return `An approval is waiting for you · ${name}`;
    case NOTIF_EVENT.inboxQuestion:
      return `Question · ${name}`;
    case NOTIF_EVENT.dependencyWait:
      return `Waiting for another task · ${name}`;
    case NOTIF_EVENT.quotaPause:
      return `Out of quota, automatic resume · ${name}`;
    // Fact first, cause second: `pushText` splits at the middle dot, so the left part is the bold
    // title, readable without unlocking; the cause can wait for the second line.
    case NOTIF_EVENT.systemPause:
      return `${plural(count(payload, "count"), "session")} suspended · ${cause(payload)}`;
    case NOTIF_EVENT.taskFailed:
      return `Task failed · ${name}`;
    case NOTIF_EVENT.repoPushFailed:
      return `Push refused · ${name}`;
    case NOTIF_EVENT.taskProposed:
      return `Task proposed · ${name}`;
    case NOTIF_EVENT.sessionRelaunched:
      return `Session restarted on its own (${plural(count(payload, "resume"), "time")}) · ${name}`;
    case NOTIF_EVENT.prCreated:
      return `PR opened · ${name}`;
    case NOTIF_EVENT.prMerged:
      return `PR merged · ${name}`;
    case NOTIF_EVENT.goalCompleted:
      return `Goal reached · ${name}`;
    case NOTIF_EVENT.goalStopped:
      return `Goal stopped · ${name}`;
    case NOTIF_EVENT.standup:
      return standupSummary(payload);
    default:
      return event;
  }
}

/** The same fact, split in two for a lock screen: the bold title says what is happening, the
 *  grey body says what it is about. The one-line summary already carries both around the middle
 *  dot; cutting there avoids a second vocabulary that would drift at the first rename.
 *
 *  A summary without a middle dot keeps everything in the title: an empty body beats an empty
 *  title. */
export function pushText(
  event: NotifEvent,
  payload: Record<string, unknown>,
): { title: string; body: string } {
  const summary = summarizeNotif(event, payload);
  const at = summary.indexOf(" · ");
  const title = at === -1 ? summary : summary.slice(0, at);
  const rest = at === -1 ? "" : summary.slice(at + 3);
  // The project leads the body, never the title: iOS already prefixes the title with the app name
  // ("Question from Legion"), and adding the project would put three names before the first fact.
  const project = typeof payload.project === "string" ? payload.project.trim() : "";
  if (!project) return { title, body: rest };
  return { title, body: rest ? `${project} · ${rest}` : project };
}
