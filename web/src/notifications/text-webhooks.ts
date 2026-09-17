// The words of the outbound webhooks card.
import { defineText } from "../i18n/catalog.js";

export const WEBHOOKS_TEXT = defineText({
  title: "Outbound webhooks",
  active: "active",
  muted: "muted (rail)",
  desc: "POST JSON {event, payload, ts} to each URL. Check the events you want — none checked = all.",
  noWebhooks: "No webhook registered — nothing is notified outside yet.",
  registeredLabel: "Registered webhooks",
  allEvents: "all events",
  remove: "Remove this webhook",
  urlLabel: "Webhook URL",
  urlHint: "POST JSON on each checked event.",
  urlPlaceholder: "https://…",
  eventsLegend: "Notified events",
  noneChecked: "None checked — every event will go out.",
  someChecked: (count: number) => `${count} event(s) selected.`,
  adding: "Adding…",
  add: "Add the webhook",
});
