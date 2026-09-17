// The words of the daily standup card.
import { defineText } from "../i18n/catalog.js";

export const STANDUP_TEXT = defineText({
  title: "Daily standup",
  desc: 'Summary of the last 24h (goals, PRs, gates, cost) to Discord + webhooks subscribed to the "standup" event.',
  sendAt: "Send every day at",
  disabled: "disabled",
  hour: (h: string) => `${h}:00`,
  sending: "Sending…",
  sendNow: "Send now",
  sent: "Standup sent.",
  previewLabel: "Standup preview",
});
