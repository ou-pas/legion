// Outbound notifications (v11): POST {event, payload, ts} to every enabled webhook.
// The global kill-switch (settings.notifications, toggled from the rail) wins over any webhook
// configuration: off means nothing leaves. Fire-and-forget everywhere: a notification never
// blocks or breaks the main flow.
import { nanoid } from "nanoid";
import { getSetting, setSetting } from "../shared/settings.js";
import { done, refuse, type Result } from "../http/from-result.js";
import { logControlEvent } from "../events/control-log-store.js";
import { allWebhooks, deleteWebhookRow, insertWebhook, projectOfTask } from "./notify-store.js";
import { NOTIF_EVENT, NOTIF_EVENTS, type NotifEvent } from "./notify-enums.js";
import { headerSafe, pushText, summarizeNotif } from "./notify-text.js";
import { notifTarget } from "./notify-target.js";
import { pushOut } from "./push.js";
// The registry, not the service: `inbox/inbox.ts` imports `notifyOut`, so importing it here
// would close a cycle.
import { broadcastText } from "../inbox/notifiers.js";

// Re-exported for existing callers (`routes.ts`, `inbox/inbox.ts`).
export { NOTIF_EVENT, NOTIF_EVENTS, type NotifEvent };

/** Events the notifiers already receive through a richer path: the three inbox entries come
 *  through `notifyInbox` with their buttons, and the standup broadcasts its own multi-line text.
 *  Broadcasting them again as one line would be a duplicate, not a reminder. */
const ALREADY_BROADCAST = new Set<NotifEvent>([
  NOTIF_EVENT.inboxQuestion,
  NOTIF_EVENT.dependencyWait,
  NOTIF_EVENT.quotaPause,
  NOTIF_EVENT.standup,
]);

export function notificationsEnabled(): boolean {
  const value = getSetting("notifications");
  return value ? value === "on" : true;
}

export function setNotificationsEnabled(on: boolean): void {
  setSetting("notifications", on ? "on" : "off");
}

// Anti-spam (review lot2 #9): a runtime must not hammer the operator's webhook.
const lastByKey = new Map<string, number>();
const RATE_MS = 10_000;

/** Emits an event to every enabled webhook whose event list accepts it. */
export function notifyOut(event: NotifEvent, payload: Record<string, unknown>): void {
  if (!notificationsEnabled()) return;
  // At most one notification every 10 s per (event, session/goal/task).
  const key = `${event}:${payload.sessionId ?? payload.goalId ?? payload.taskId ?? ""}`;
  const now = Date.now();
  if (now - (lastByKey.get(key) ?? 0) < RATE_MS) return;
  lastByKey.set(key, now);
  // One fact, two outputs (13/09). Notifiers used to receive only inbox entries and the standup,
  // so `gate_waiting` never reached a phone. The sentence is written once, here, for both.
  // Broadcast before the webhook filter: a channel with no webhook must still be told.
  //
  // The project is added here and nowhere else (14/09): its name because "Question · Interview …"
  // on a lock screen does not say what it is about, its id because the target URL needs it.
  // Eleven callers emit notifications; asking each one to add the project would be eleven chances
  // to forget. The webhooks get both fields too, on purpose.
  const enriched = enrichWithProject(payload);
  const summary = summarizeNotif(event, enriched);
  if (!ALREADY_BROADCAST.has(event)) broadcastText(summary);
  // Push is an output of this function, not a notifier (13/09): it needs the event name to keep
  // to what is really waiting for the operator, and a notifier only receives finished text. Wired
  // here, it inherits the kill-switch, the anti-spam and the webhook filter convention. No
  // duplicate exception, unlike `broadcastText`: a Discord channel and a locked phone are not the
  // same screen, and the operator often watches only one.
  const push = pushText(event, enriched);
  // The notification opens the screen it is about (14/09): the channel for a question, the PR
  // view for a gate, the trace for a failure.
  pushOut(event, push.title, push.body, notifTarget(event, enriched));
  const hooks = allWebhooks().filter((w) => {
    if (!w.enabled) return false;
    const events = JSON.parse(w.events) as string[];
    return events.length === 0 || events.includes(event);
  });
  if (hooks.length === 0) return;
  const body = JSON.stringify({ event, payload: enriched, ts: Date.now() });
  for (const w of hooks)
    void fetch(w.url, {
      method: "POST",
      // `X-Title` is shown as-is by push clients (ntfy, Gotify) and ignored by the rest: the body
      // does not change, so the contract with programmatic webhooks holds.
      headers: { "content-type": "application/json", "x-title": headerSafe(summary) },
      body,
      signal: AbortSignal.timeout(8000),
    }).catch((err) => {
      const detail = String((err as Error)?.message).slice(0, 120);
      logControlEvent("error", "integration", `webhook ${w.url} failed (${event}): ${detail}`, {
        webhookId: w.id,
        event,
      });
    });
}

export function listWebhooks() {
  return allWebhooks().map((w) => ({ ...w, events: JSON.parse(w.events) as string[] }));
}

/** The created webhook, or the named reason for the refusal (returned rather than thrown since
 *  06/09; the screen shows these sentences). */
export function createWebhook(url: string, events: string[]): Result<{ id: string }> {
  const u = url.trim();
  if (!/^https?:\/\//.test(u)) return refuse(400, "an http(s) URL is required");
  // A misspelt event would silently never match (review lot2 #15).
  const bad = events.filter((e) => !(NOTIF_EVENTS as string[]).includes(e));
  if (bad.length)
    return refuse(
      400,
      `unknown event(s): ${bad.join(", ")} — valid ones: ${NOTIF_EVENTS.join(", ")}`,
    );
  const id = nanoid(10);
  insertWebhook({
    id,
    url: u,
    events: JSON.stringify(events),
    enabled: true,
    createdAt: new Date(),
  });
  return done({ id });
}

export function deleteWebhook(id: string): void {
  deleteWebhookRow(id);
}

/** Adds the task's project to a notification, once for all its outputs.
 *
 *  Returned unchanged when there is nothing to add: an emitter that already names its project
 *  wins over the database, and an instance event (the standup) has no task. */
function enrichWithProject(payload: Record<string, unknown>): Record<string, unknown> {
  if (typeof payload.project === "string" || typeof payload.taskId !== "string") return payload;
  const project = projectOfTask(payload.taskId);
  return project ? { ...payload, project: project.name, projectId: project.id } : payload;
}
