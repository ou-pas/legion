// The VOCABULARY of the projects domain: the words several screens share — the button four
// settings cards save with, and the branch a repo chip names everywhere it appears (timeline, PR
// header, draft footer). What belongs to a single screen lives in that screen's catalog
// (`text/project-page.ts`, `text/secrets.ts`…).
import { defineText } from "../../i18n/catalog.js";
import { plural } from "../../ui/plural.js";

export const PROJECT_TEXT = defineText({
  /** The same button in four cards: the verb at rest, the acknowledgement for 1.5 s after. */
  save: "Save",
  saved: "Saved",

  /** The working branch carried by a repo chip — the name itself is data. */
  branch: (name: string) => `branch ${name}`,

  /** THE PROJECT NAVIGATION (nav work): the icon rail and the entries of the rail next to it.
   *
   *  The labels live HERE and no longer in the `SUB` array of `project.tsx`, because the same
   *  entry is named in three places — the rail, the tab title, the palette — and a label written
   *  three times ends up differing. "The project" became "Settings" on 29/08: two scopes, two
   *  words (the rail sets a project, the gear in the bar sets the machine), and it was the
   *  renaming that showed the word had no home. */
  rail: {
    board: "Board",
    /** The PROJECT inbox (07/09, evening): the same list as `/inbox`, filtered on it. The project
     *  rail carries it because a question's page lives under `/p/<project>/inbox/…` and, without
     *  an entry, nothing in the rail said where you were. */
    inbox: "Inbox",
    goals: "Goals",
    schedules: "Scheduled",
    reviews: "Pull requests",
    issues: "Issues",
    agents: "Agents",
    /** Became "Library" on 12/09: "Capabilities" named both this screen and, in the wiki, what is
     *  granted to an agent. The path followed the label (`libraries`); `capabilities` redirects. */
    capabilities: "Library",
    settings: "Settings",
    /** The two subheadings of the mockup: what you run, then what you read back, then what you
     *  set. The first group carries none — it starts the column. */
    review: "Review",
    configure: "Configure",
    /** The row that goes back up from a section (Settings, Library) to the project rail. It names
     *  its DESTINATION and not the place you leave: that is what an arrow does everywhere else,
     *  and the section itself is written in the rail's head. */
    back: "Project",
    /** The second segment of the head when the rail carries a task's views (slice nav/17): once
     *  the project list is replaced, it is the only thing left that says what you are looking at.
     *  The task NAME is already the screen's h1, two lines to the right. */
    task: "Task",
    /** The rail head opens the project menu (04/09): this is the button's accessible name. */
    switch: "Switch project",
    add: "New project",
    pending: (count: number) => `${count} ${plural(count, "decision")} waiting`,
    /** The badge on the PR view of a task's rail: how many files its change touches. */
    filesChanged: (n: number) => `${n} ${plural(n, "file")} changed`,
  },

  /** The NEW PROJECT modal, opened from the rail head. Two ways in: an empty project, or a crate
   *  to import — the crate tab carries its own buttons, so only the blank form uses the footer. */
  newProject: {
    title: "New project",
    modeLabel: "How to create the project",
    blank: "Blank",
    crate: "Import a crate",
    name: "Name",
    namePlaceholder: "e.g. acme",
    fsRoot: "Output folder",
    fsRootPlaceholder: "e.g. /Users/…/acme-workspace",
    repoUrl: "Repo URL",
    repoUrlHint:
      "https or SSH (git@host:path) — a “default” agent and an “open” environment are created with the project",
    repoUrlPlaceholder: "e.g. https://github.com/org/repo.git",
    cancel: "Cancel",
    create: "Create",
  },
});
