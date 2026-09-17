// The text of the ⌘K PALETTE. Every command carries two things: the label you read, and the
// keywords that make it findable — unaccented, because the search compares raw lowercase. Both
// travel together.
import { defineText } from "../../i18n/catalog.js";
import { ENTER } from "../../ui/platform.js";

export const PALETTE_TEXT = defineText({
  label: "Command palette",
  search: "Search for a command",
  placeholder: "Run a task, go to a page…",
  escape: "Esc",
  /** The key that RUNS the active item, written the way it is engraved (ui/platform.ts). It was
   *  inline in the component, the only keyboard mark on the screen not coming from here. */
  enter: ENTER,
  list: "Commands",
  noMatchTitle: "No command matches",
  noMatchWhy: (query: string) =>
    `“${query}” matches no command. Clear the search to see the list again.`,

  group: {
    actions: "Actions",
    goTo: "Go to",
    projects: "Projects",
    id: "Id",
    wiki: "Wiki",
  },

  /** Pasting an id or a URL opens the target directly (26/08). The label carries the NAME, not the
   *  id: nobody recognizes a nanoid, and offering "Open aY4Mjb00Ln" would not prove the right
   *  thing was found. */
  id: {
    kind: { task: "Task", goal: "Goal", agent: "Agent", project: "Project" },
    open: (kind: string, label: string) => `${kind} · ${label}`,
    keywords: (id: string, label: string) => `${id} ${label} open go`,
    searching: "Looking up the id…",
    /** Distinct from "no command": here we HAVE searched, and the id does not exist. The two
     *  sentences say different things and must not blur together. */
    unknownTitle: "Unknown id",
    unknownWhy: (id: string) => `“${id}” matches no task, no goal, no agent and no project.`,
  },

  command: {
    newTask: { label: "Create a task", keywords: "new task run start create" },
    newGoal: {
      label: "Create a goal",
      keywords: "goal objective orchestration dod definition of done",
    },
    newProject: { label: "New project", keywords: "project add create" },
    /** `/` leads to the LAST PROJECT opened since slice nav/04: there is no global dashboard left
     *  to promise. The word "dashboard" stays as a keyword, because it is what people still type
     *  out of habit. */
    home: { label: "Home", keywords: "home dashboard last project" },
    inbox: { label: "Inbox", keywords: "questions messages box" },
    system: { label: "System", keywords: "system settings runners models log gear" },
    // "Runners", and no longer "Infra" (General work, 02/09): the same renaming as the page title
    // and the tab — the screen only speaks of the machine fleet now. The keyword "infra" stays for
    // whoever still types it out of habit.
    infra: { label: "Runners", keywords: "infra docker containers runners system" },
    logs: { label: "Log", keywords: "logs control plane events boot migrations system" },
    analytics: { label: "Analytics", keywords: "analytics stats costs metrics system" },
  },
  /** A project opens its board: the project name is also its keyword. */
  projectKeywords: (name: string) => `project ${name} board goals issues`,
  /** A wiki page is searched by its title, but also by its path and its SECTION: "docker" has to
   *  bring back the infra section's pages without knowing their titles. */
  wikiKeywords: (slug: string, section: string) =>
    `wiki doc documentation ${slug.replaceAll("/", " ")} ${section}`,
});
