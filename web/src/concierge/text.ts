// The text catalog of the concierge domain — what SHOWS state lives elsewhere; here it is put
// into words.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

/** The age of a situation report, written the way you would say it. The exact minute is of no
 *  interest past an hour: what you want to know is whether it is stale. */
function age(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export const CONCIERGE_TEXT = defineText({
  panelTitle: "Concierge",
  name: "Concierge",
  you: "You",
  label: "Ask the concierge",
  placeholder: "what ran overnight?",
  ask: "Ask",
  thinking: "looking…",
  empty: {
    title: "Nothing asked yet",
    body:
      "Ask about what is running, what is blocked, or what it cost — it reads " +
      "the control plane and never changes it: it is given no write tool.",
  },
  /** The foot of the hover panel: the panel asks the quick question, the page is where you come
   *  back to. */
  toPage: "Open the page",
  page: {
    title: "Concierge",
    sub: "What is running, what is blocked, what it costs — across every project.",
    readOnly: "read-only · no write tool",
    /** "Start over" and not "new conversation": the word says what you gain, not the object you
     *  are making. What you want at that moment is a clean subject. */
    fresh: "Start over",
  },
  brief: {
    who: "situation report",
    age,
    scope: (projects: number) => (projects <= 1 ? "" : `, across ${projects} projects`),
    refresh: "refresh it",
    refreshing: "refreshing…",
    /** The triage, in the mock-up's words. */
    severity: { now: "now", soon: "soon", fyi: "for info" },
    open: "Open",
    /** The one state with no situation report: nothing has run yet. */
    first: {
      title: "Nothing to report yet",
      body:
        "The concierge reads what the control plane knows: sessions, tasks, blockers, spending. " +
        "Nothing has run yet, so there is no situation to report.",
      action: "Create a project",
      after:
        "From the first session on, the situation report writes itself at the top of this page.",
    },
    failed: "The situation report could not be refreshed",
  },
  conversations: {
    title: "Conversations",
    empty: {
      title: "No conversation",
      body:
        "Ask it a question from the situation report: it will be here on the next " +
        "load, and will pick up where it left off.",
    },
    turns: (n: number) => `${n} ${plural(n, "turn")}`,
    untitled: "(no question)",
  },
});
