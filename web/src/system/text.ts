// The vocabulary of the system. "System" and not "Settings": the project rail already has
// settings, and those belong to a project. Two scopes, two words — one lives under the project
// name, the other above everything.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const SYSTEM_TEXT = defineText({
  title: "System",
  sub: "The workstation, not the work: runners, control plane log, analytics, general.",
  /** The subtitle of "General" (02/09 work): what Infra carried without speaking of machines —
   *  version, identity, and the two outgoing notifications. */
  generalSub:
    "What is not a machine: the running version, the control plane identity, the daily standup and the webhooks.",
  /** The two sections that had no subtitle when their three sisters had one (header alignment,
   *  02/09): every System screen says what you read there. */
  logsSub:
    "What the control plane did to itself: boot, migrations, queue, recovered sessions, integrations.",
  analyticsSub: "Cost, duration and failure rate of sessions, by agent and by model.",
  /** The log screen itself (`infra/LogsPage.tsx`): it reads the control plane, not the fleet, so
   *  its words live here rather than in the infra catalog. */
  logs: {
    refresh: "Refresh",
    loading: "Loading the control plane log…",
    errorTitle: "The log is not answering",
    retry: "Retry",
    errorBody:
      "The control plane events could not be read. Boot, migrations, queue and integrations stay invisible while this call fails.",
    level: "Level",
    levelAll: "all",
    levelLabel: { info: "info", warn: "warning", error: "error" },
    limit: "Limit",
    filterPlaceholder: "Filter by source or message…",
    filterLabel: "Filter the events shown (source or message)",
    emptyTitle: "No event",
    noMatchTitle: "No event matches",
    emptyBody:
      "The control plane has recorded nothing at this level yet — boot, migrations, queue and integrations will write here.",
    noMatchBody:
      "No source and no message matches the current filter — widen the search or change level.",
    count: (n: number) => `${n} ${plural(n, "event")}`,
    limitReached: (n: number) => `${n} limit reached — raise it to go further back`,
    thLevel: "Level",
    thSource: "Source",
    thMessage: "Message",
    thDetail: "Detail",
    thTime: "Timestamp",
    payload: (id: number, source: string) => `Payload of event #${id} (${source})`,
    payloadShort: (id: number) => `Payload of event #${id}`,
    table: "Latest control plane events",
  },
  tab: {
    infra: "Runners",
    logs: "Log",
    analytics: "Analytics",

    general: "General",
  },
});
