import { json, post } from "./client.js";

export type Webhook = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
};

export const notificationsApi = {
  notifications: (): Promise<{ enabled: boolean; webhooks: Webhook[]; events: string[] }> =>
    fetch("/api/notifications").then(json),
  toggleNotifications: (enabled: boolean): Promise<{ enabled: boolean }> =>
    post("/api/notifications/toggle", { enabled }),
  createWebhook: (body: { url: string; events?: string[] }) => post("/api/webhooks", body),
  deleteWebhook: (id: string) => fetch(`/api/webhooks/${id}`, { method: "DELETE" }).then(json),
  standup: (): Promise<{ hour: number | null; preview: string }> =>
    fetch("/api/standup").then(json),
  setStandupHour: (hour: number | null) => post("/api/standup/hour", { hour }),
  sendStandup: () => post("/api/standup/send"),
};

/** What the server knows of a subscribed browser. The full endpoint is not sent down: its tail is
 *  enough to tell two phones apart in a list. */
export type PushSubscriptionSummary = {
  id: string;
  label: string | null;
  events: string[];
  createdAt: string;
  lastSeenAt: string;
  endpointTail: string;
};

export const pushApi = {
  key: (): Promise<{ publicKey: string }> => fetch("/api/push/key").then(json),
  subscriptions: (): Promise<{ subscriptions: PushSubscriptionSummary[] }> =>
    fetch("/api/push/subscriptions").then(json),
  subscribe: (body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    events?: string[];
    label?: string | null;
  }): Promise<{ id: string }> => post("/api/push/subscriptions", body),
  unsubscribe: (id: string) =>
    fetch(`/api/push/subscriptions/${id}`, { method: "DELETE" }).then(json),
};
