// The text of the SHELL: the topbar, the rail, the document titles of each route, and the "not
// found" screen. It lives in `app/` because it speaks of no domain in particular — it NAMES them
// all (arbitration rule of CLAUDE.md: several domains → the screen that composes them).
import { defineText } from "../../i18n/catalog.js";
import { combo } from "../../ui/platform.js";
import { plural } from "../../ui/plural.js";

export const SHELL_TEXT = defineText({
  brand: "Legion",
  // `user` left with the avatar (13/09). All that was left was an initial and a first name written
  // inline, which was never vocabulary: the day Legion knows several people, a name comes from the
  // database, not from a text catalog.
  /** The icon rail will list the projects (slice 02); its accessible name says so already, because
   *  a navigation without a name reads as "navigation" twice on the same page. */
  iconRail: "Projects",

  /** THE PHONE TAB BAR (13/09, `compact` breakpoint). The labels of the first three tabs are NOT
   *  here: they come from `PROJECT_ROWS`, like the rail's. The same destination must be named the
   *  same way whether you reach it with a thumb or with a mouse, and two lists of labels would end
   *  up diverging without anyone noticing. */
  tabBar: {
    label: "Navigation",
    more: "More",
    moreLabel: "Open the rest of the navigation",
    /** The exit from screens that belong to no project: the System, the wiki, the concierge.
     *  "Projects" and not "Home" — the root is not a home page, it is a switch towards the last
     *  project opened, and that is what the operator finds there. */
    home: "Projects",
  },

  topbar: {
    command: "Run a task, search…",
    questions: (count: number) => `${count} ${plural(count, "question")}`,
    activeSessions: (count: number) => `${count} ${plural(count, "active session")}`,
    /** The failure that makes everything else useless (26/08). It was readable on /infra, so you
     *  had to go looking for it: Docker off, `make image` hanging with nothing on screen, two tasks
     *  filed as failed, and an hour spent digging through Docker layers.
     *
     *  The chip links to `/system/general` (`version-chip.tsx`), not `/infra` — Infra split into
     *  System › Runners and System › General, and this text has to name where the click lands. */
    versionTitle: (tag: string) => `${tag} is available. Open System › General to update.`,
    /** The same chip when the gesture is on hold: the version still exists, and the reason for the
     *  wait reads without leaving the screen you are on. */
    versionBlockedTitle: (tag: string, reason: string) =>
      `${tag} is available, but not right now: ${reason}`,
    dockerDown: "Docker unreachable",
    /** The docker popover navigates to `/system/runners` (`RunnersStatusCard`'s `onNavigate` in
     *  `top-bar.tsx`) — the fleet screen, not the retired Infra one. */
    dockerDownTitle: "No Docker daemon answers: no session can start. Open System › Runners.",

    /** THE STATUS GROUP (slice nav/03) — what stays true everywhere: sessions and Docker speak of
     *  the MACHINE and never change from one project to another. The bar says the machine; the
     *  content says the project. (A quota window used to sit with them and followed the open
     *  project instead; removed on 30/08 for lack of a measure readable on every account.) */
    status: "Machine status",
    sessions: (count: number) => `${count} ${plural(count, "session")}`,
    sessionsTitle: "All sessions, all projects — this is the machine's capacity.",
    dockerOk: "docker ok",
    dockerOkTitle: "The declared runners answer.",
    dockerImage: "image missing",
    dockerImageTitle:
      "The session image is not built: no session can start. Open System › Runners.",
    pending: (count: number) => `${count} waiting`,
    pendingTitle: "Questions waiting for you — a request from the running session.",
    /** THE UPDATE UNDER WAY (02/09): visible from any screen, not only from the Version panel —
     *  that is the whole point of the operator's remark ("the front end does not catch it while it
     *  is running"). It disappears with the gesture, like the other chips in this group. */
    updating: "Update under way",
    updatingTitle: "A control plane update is running right now. Follow it on System › General.",

    /** The global actions of the bar. The wiki has its OWN entry, never inside the system: you open
     *  it in the middle of something else to find out, and two clicks behind a tool icon is where
     *  documentation dies (nav decisions). */
    /** The palette has always opened from the keyboard and said so nowhere: the only place that
     *  could have written it was this title, and it did not. */
    search: `Search — tasks, agents, wiki pages (${combo("K")})`,
    wiki: "The wiki",
    system: "System — runners, models, logs",
    /** The theme and the notifications are not routes: two switches, not two navigation entries.
     *  They left the project rail with everything that is global. */
    /** The button cycles: it says WHAT IT FOLLOWS now, and what one click will bring. */
    theme: (pref: "system" | "light" | "dark") =>
      pref === "system"
        ? "Device theme — switch to light"
        : pref === "light"
          ? "Light theme — switch to dark"
          : "Dark theme — follow the device",
    notifications: (on: boolean) =>
      on ? "Notifications on — turn them off" : "Notifications off — turn them back on",
    notificationsFailed: "Notifications unchanged",
  },

  rail: {
    pilot: "Run",
    dashboard: "Dashboard",
    inbox: "Inbox",
    system: "System",
    infra: "Infra",
    logs: "Log",
    analytics: "Analytics",
    wiki: "Wiki",
    notifications: "Notifications",
    webhooks: (count: number) => `${count} ${plural(count, "webhook")}`,
    notificationsFailed: "Notifications unchanged",
    pendingQuestions: (count: number) => `${count} ${plural(count, "question")} waiting`,
    infraAlerts: (count: number) =>
      `${count} ${plural(count, "infrastructure anomaly", "infrastructure anomalies")}`,
    activeSessions: (count: number) => `${count} ${plural(count, "active session")}`,
  },

  /** The document title, per route — what the browser tab reads. */
  route: {
    // `/` is no longer a screen: it is the switch towards the last project, or the preflight when
    // there is nothing to run (slice nav/04). Hence two titles instead of one.
    noProject: "First project",
    system: "System",
    // "Runners", and no longer "Infra" (General work, 02/09): since version, identity and
    // notifications left for System › General, this screen only speaks of the machine fleet — the
    // tab title has to say what it became, like the page title.
    inbox: "Inbox",
    infra: "Runners",
    logs: "Log",
    analytics: "Analytics",
    wiki: "Wiki",
    task: "Task",
    goal: "Goal",
    agent: "Agent",
    board: "Board",
    goals: "Goals",
    issues: "Issues",
    reviews: "Reviews",
    // "Settings" and no longer "Project" (29/08): the rail and the tab name the same page, and the
    // renaming showed that each named it on its own side (projects/text/vocabulary.ts).
    project: "Settings",
    agents: "Agents",
    // Became "Library" on 12/09 (projects/text/vocabulary.ts carries the why): the URL path stays
    // `capabilities`, only the label changes.
    capabilities: "Library",
    chainRun: "Chain flow",
    schedules: "Scheduled",
  },

  notFound: {
    title: "Project not found",
    body: "This project does not exist, or it was deleted. Its id appears in none of the loaded projects.",
    action: "Back to home",
  },

  /** The failures of the shared mutations (`queries.ts`), which are nobody's screen. */
  answerRefused: "Answer refused",
});
