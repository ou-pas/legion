import { Hono } from "hono";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  NOTIF_EVENTS,
  notificationsEnabled,
  setNotificationsEnabled,
} from "../notifications/notify.js";
import {
  buildStandup,
  getStandupHour,
  sendStandup,
  setStandupHour,
} from "../notifications/standup.js";
import {
  deletePushSubscription,
  listPushSubscriptions,
  savePushSubscription,
  vapidPublicKey,
} from "../notifications/push.js";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import { fromResult } from "../http/from-result.js";

/** `hour` is `null` or an integer 0-23; `null` is a value: it turns the daily standup off. */
const standupHourBody = z.strictObject({ hour: z.number().int().min(0).max(23).nullable() });
const notificationsToggleBody = z.strictObject({ enabled: z.boolean() });
/** Events are still judged by `createWebhook`, which names the unknown ones and lists the valid
 *  ones in the same message. `NOTIF_EVENTS` is not an `as const` tuple, so `z.enum` cannot take
 *  it, and its message would be less useful anyway. */
const createWebhookBody = z.strictObject({
  url: z.string(),
  events: z.array(z.string()).optional(),
});

/** Exactly the shape of `PushSubscription.toJSON()`, relayed as-is by the screen. The `endpoint`
 *  must be `https` because the server will POST to it: any scheme would turn this route into an
 *  outbound relay driven by the request body. */
const subscribeBody = z.strictObject({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.strictObject({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  events: z.array(z.string()).optional(),
  label: z.string().max(60).nullable().optional(),
});

export function registerNotificationRoutes(app: Hono): void {
  app.get("/api/standup", (c) => c.json({ hour: getStandupHour(), preview: buildStandup().text }));
  app.post("/api/standup/hour", async (c) => {
    const parsed = await parseBody(c, standupHourBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    setStandupHour(parsed.value.hour);
    return c.json({ hour: getStandupHour() });
  });
  app.post("/api/standup/send", (c) => {
    sendStandup();
    return c.json({ ok: true });
  });

  app.get("/api/notifications", (c) =>
    c.json({ enabled: notificationsEnabled(), webhooks: listWebhooks(), events: NOTIF_EVENTS }),
  );

  app.post("/api/notifications/toggle", async (c) => {
    const parsed = await parseBody(c, notificationsToggleBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    setNotificationsEnabled(parsed.value.enabled);
    return c.json({ enabled: notificationsEnabled() });
  });

  app.post("/api/webhooks", async (c) => {
    const parsed = await parseBody(c, createWebhookBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return fromResult(c, createWebhook(parsed.value.url, parsed.value.events ?? []), 201);
  });

  app.delete("/api/webhooks/:id", (c) => {
    deleteWebhook(c.req.param("id"));
    return c.json({ ok: true });
  });

  // The VAPID key is served on demand, not baked into the screen build: it belongs to the
  // instance, and a hardcoded key would break every other instance.
  app.get("/api/push/key", (c) => c.json({ publicKey: vapidPublicKey() }));

  app.get("/api/push/subscriptions", (c) => c.json({ subscriptions: listPushSubscriptions() }));

  // Idempotent because the browser returns the same endpoint each time a known phone
  // re-subscribes; refusing the duplicate would break reopening the app.
  app.post("/api/push/subscriptions", async (c) => {
    const parsed = await parseBody(c, subscribeBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { endpoint, keys, events, label } = parsed.value;
    return c.json(
      savePushSubscription({
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        events,
        label: label ?? null,
      }),
      201,
    );
  });

  app.delete("/api/push/subscriptions/:id", (c) => {
    deletePushSubscription(c.req.param("id"));
    return c.json({ ok: true });
  });
}
