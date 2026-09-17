// The text of the INBOUND webhooks (webhooks batch, 03/09) — the System → General card and the
// per-repo button (projects/repos-section.tsx, which imports it from here: a domain's vocabulary
// lives next to its domain, and this is a single one).
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const INBOUND_WEBHOOKS_TEXT = defineText({
  card: {
    title: "Inbound webhooks",
    desc:
      "Forges ring here when a PR moves: once it is merged, the task in review turns done on its own. " +
      "The public URL is the host exposed by Tailscale Funnel — only the /webhooks path is mounted.",
    baseUrlLabel: "Public URL",
    baseUrlHint: "https://<machine>.<tailnet>.ts.net — no path. Empty means webhooks are off.",
    save: "Save",
    saved: "Saved",
    notConfigured: "no public URL",
    ready: (repos: number) =>
      repos === 0 ? "ready — no repo connected" : `${repos} ${plural(repos, "repo")} connected`,
    secretReady:
      "Instance secret generated — the server presents it to the forges, it is never shown.",
    secretPending: "The secret is generated the first time a repo is connected.",
    whereToConnect:
      "Connecting happens repo by repo: Project → Settings → Repos, “Connect the webhook” button.",
  },
  repo: {
    /** THE ONE GESTURE OF THE ROW THAT KEEPS ITS WORDS, and the reason is in the words: connecting
     *  a webhook acts AT the provider. "Connect" alone does not say what, two centimetres away
     *  from a "+" that connects a repository. */
    connect: "Connect the webhook",
    reconnect: "Reconnect the webhook",
    connected: "webhook connected",
    /** The public URL has changed since the webhook was connected: the forge's hook calls a dead
     *  address. Reconnecting creates one on the new address (the old one is deleted at the
     *  forge). */
    stale: "webhook to reconnect (the public URL changed)",
    failed: "Webhook not connected",
  },
});
