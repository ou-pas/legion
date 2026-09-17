// Web Push (13/09), the second output of `notifyOut` next to the webhooks.
//
// Not a notifier: notifiers (Discord) receive finished text, and the registry
// (`inbox/notifiers.ts`) does not know the event vocabulary. Push has to keep to what is really
// waiting for the operator, so it needs the event name, which only `notifyOut` holds.
//
// What the server sends is an encrypted message POSTed to a vendor URL (`*.push.apple.com`,
// `fcm.googleapis.com`, `*.mozilla.com`) that relays it without reading it, using keys the
// browser made and we store as-is. No developer account, no third party: outbound access only.
//
// The VAPID keys are the server's identity and must survive. Browsers remember them at
// subscription time: regenerating them silently invalidates every subscription (sends go out,
// the push service refuses them, nobody is told). So they live in `settings`, private key
// encrypted, and are made once.
//
// iOS needs three things: iOS 16.4+, the app added to the home screen (push does not work in a
// Safari tab), and a secure origin. The third is why TLS arrived on 13/09.
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import {
  getEncryptedSetting,
  getSetting,
  setEncryptedSetting,
  setSetting,
} from "../shared/settings.js";
import { logControlEvent } from "../events/control-log-store.js";
import { publicBaseUrl } from "../integrations/inbound-webhooks.js";
import {
  allPushSubscriptions,
  deletePushSubscriptionByEndpoint,
  deletePushSubscriptionRow,
  touchPushSubscription,
  upsertPushSubscription,
  type PushSubscriptionRow,
} from "./push-store.js";
import type { NotifEvent } from "./notify-enums.js";

const PUBLIC_KEY = "push.vapid_public";
const PRIVATE_KEY = "push.vapid_private";

/** Four hours. The push service keeps the message while the phone is unreachable and delivers it
 *  when it comes back: without a cap, a phone switched on the next morning dumps the whole night
 *  at once. Four hours cover a nap and a commute, not a night. */
const PUSH_TTL_SECONDS = 4 * 60 * 60;

/** The identity declared to the push service. VAPID asks for a `mailto:` or a URL through which
 *  the vendor could reach the server's operator. The instance's public URL says exactly that when
 *  known; the fallback is a generic name, never a personal address, since this repository is
 *  meant to be read. */
function vapidSubject(): string {
  const base = publicBaseUrl();
  return base && /^https?:\/\//.test(base) ? base : "mailto:operator@legion.invalid";
}

/** Both keys, generated on the first call and never again. Returned as a pair because neither is
 *  of any use alone. */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  const existingPublic = getSetting(PUBLIC_KEY);
  const existingPrivate = getEncryptedSetting(PRIVATE_KEY);
  if (existingPublic && existingPrivate)
    return { publicKey: existingPublic, privateKey: existingPrivate };
  const fresh = webpush.generateVAPIDKeys();
  setSetting(PUBLIC_KEY, fresh.publicKey);
  setEncryptedSetting(PRIVATE_KEY, fresh.privateKey);
  logControlEvent("info", "integration", "VAPID keys generated (Web Push)");
  return fresh;
}

/** The key the screen hands to the browser to subscribe. Public in the proper sense. */
export function vapidPublicKey(): string {
  return vapidKeys().publicKey;
}

/** Registers (or re-registers) a browser. Empty `events` means every event, as for webhooks. */
export function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  events?: string[];
  label?: string | null;
}): { id: string } {
  const id = randomUUID();
  const now = new Date();
  upsertPushSubscription({
    id,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    events: JSON.stringify(input.events ?? []),
    label: input.label ?? null,
    createdAt: now,
    lastSeenAt: now,
  });
  return { id };
}

export function listPushSubscriptions() {
  return allPushSubscriptions().map((s) => ({
    id: s.id,
    label: s.label,
    events: JSON.parse(s.events) as string[],
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    // The tail tells two phones apart in a list and is not enough to replay a send.
    endpointTail: s.endpoint.slice(-12),
  }));
}

export function deletePushSubscription(id: string): void {
  deletePushSubscriptionRow(id);
}

/** True if this subscription wants this event. Empty list means everything, as for a webhook. */
export function subscriptionWants(row: PushSubscriptionRow, event: NotifEvent): boolean {
  const events = JSON.parse(row.events) as string[];
  return events.length === 0 || events.includes(event);
}

/** A subscription the push service declares dead will not come back.
 *
 *  404 (unknown endpoint) and 410 (expired) are the only codes that say so, and the only signal
 *  we get: an uninstalled app tells nobody. Anything else (429, 500, a network cut) is transient
 *  and must not delete the row, or a ten-minute vendor outage would unsubscribe the operator for
 *  good. */
export function isGonePushStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** Sends the summary to every browser subscribed to this event. Fire-and-forget, like webhooks. */
export function pushOut(event: NotifEvent, title: string, body: string, url: string): void {
  const targets = allPushSubscriptions().filter((s) => subscriptionWants(s, event));
  if (targets.length === 0) return;
  const keys = vapidKeys();
  const payload = JSON.stringify({ title, body, url, event });
  for (const sub of targets)
    void webpush
      .sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
          vapidDetails: {
            subject: vapidSubject(),
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: PUSH_TTL_SECONDS,
        },
      )
      .then(() => touchPushSubscription(sub.id, new Date()))
      .catch((err: unknown) => {
        const status = (err as { statusCode?: number }).statusCode;
        if (isGonePushStatus(status)) {
          deletePushSubscriptionByEndpoint(sub.endpoint);
          logControlEvent("info", "integration", `push subscription expired, removed (${status})`);
          return;
        }
        const detail = String((err as Error)?.message).slice(0, 120);
        logControlEvent("error", "integration", `push failed (${event}): ${detail}`, { event });
      });
}
