// The text of the DANGER section: deleting a project, and what it takes with it.
//
// SINGULAR AND PLURAL ARE SPELLED OUT BY HAND. Appending an "s" to the whole phrase used to
// produce "7 question d'inboxs". A report of destruction has no right to be approximate, so each
// word carries both of its forms, whatever the language makes of them.
import { defineText } from "../../i18n/catalog.js";
import { plural } from "../../ui/plural.js";

export const DANGER_CARD_TEXT = defineText({
  title: "Danger zone",
  /** The card description, cut around the `server/legion.db` code chip: what deleting costs, and
   *  the only way back. */
  descBefore:
    "Deleting a project is permanent and cannot be undone from the interface. The database is a file: a copy of",
  descAfter: "taken before the deletion is the only way back.",
  /** An empty project has no report to make: there is only its declaration. */
  empty: "This project is empty: there is only its declaration to delete.",
  /** "Deleting X will also destroy …" — the sentence is cut by the project name in bold. */
  willDestroyBefore: "Deleting ",
  willDestroyAfter: (parts: string) => ` will also destroy ${parts}.`,
  /** We REFUSE while a session is working: its container is still running and would lose its
   *  callback target mid-flight. */
  live: (count: number, sessions: string) =>
    `Not possible right now: ${count} ${plural(count, "session")} running (${sessions}). Stop them before deleting the project.`,
  liveEntry: (taskName: string, status: string) => `${taskName} — ${status}`,
  remove: (project: string) => `Delete project ${project}`,
  removeConfirm: "Confirm — this is permanent",
  announce: (project: string, parts: string) => `Permanently delete ${project} and ${parts}`,
  announceAlone: "its declaration",
});

/** What deletion takes with it, counted line by line. Only NON-ZERO lines are written:
 *  "0 goals, 0 rules, 0 secrets" is noise that drowns what matters in the decision. */
export const FOOTPRINT_WORDS: readonly (readonly [key: string, one: string, many: string])[] = [
  ["tasks", "task", "tasks"],
  ["sessions", "session", "sessions"],
  ["inbox", "inbox question", "inbox questions"],
  ["agents", "agent", "agents"],
  ["goals", "goal", "goals"],
  ["repos", "repo", "repos"],
  ["rules", "rule", "rules"],
  ["mcpServers", "MCP server", "MCP servers"],
  ["secrets", "secret", "secrets"],
  ["environments", "environment", "environments"],
  ["templates", "template", "templates"],
];
