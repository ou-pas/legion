// What the top bar names: the current screen, nothing else.
//
// The bar used to carry the product brand and screens were only named in their page header, at a
// height that varied between screens. The brand moved to the head of the icon rail (04/09, "flat"
// mockup); the bar now names the screen in the same place on every route, like a document title in
// a tab.
//
// A PURE function of the path, like `railSectionOf` and `railRowsFor`: "what is this screen called"
// has one answer per URL, and a table reads and tests at once. The words are `SHELL_TEXT.route`'s,
// which already names each screen for the document title: bar and browser tab say the same word
// because they read the same line.
import { CHANNELS_TEXT } from "../channels/text.js";
import { CONCIERGE_TEXT } from "../concierge/text.js";
import { SHELL_TEXT } from "./text/shell.js";

export type PageTitle = {
  title: string;
  /** The SECOND segment, when the screen carries an object: the open task's id. The project is not
   *  there: it is written at the head of the rail, once is enough. */
  crumb: string | null;
};

const SCREEN = /^\/p\/[^/]+\/([^/]+)(?:\/([^/]+))?/;

/** A project's screens, by first segment under `/p/<id>`. A table rather than a chain of
 *  conditions, and `SHELL_TEXT.route` guarantees a renamed screen changes name here AND in the tab.
 *
 *  The French segments (`canaux`, `planifiees`) are the pre-12/09 URLs (nav work, batch 5): they
 *  redirect in a `beforeLoad`, so they exist for an instant. */
const PROJECT_SCREENS: Record<string, string> = {
  board: SHELL_TEXT.route.board,
  channels: CHANNELS_TEXT.nav,
  canaux: CHANNELS_TEXT.nav,
  inbox: SHELL_TEXT.route.inbox,
  goals: SHELL_TEXT.route.goals,
  scheduled: SHELL_TEXT.route.schedules,
  planifiees: SHELL_TEXT.route.schedules,
  reviews: SHELL_TEXT.route.reviews,
  issues: SHELL_TEXT.route.issues,
  agents: SHELL_TEXT.route.agents,
  libraries: SHELL_TEXT.route.capabilities,
  // `capabilities` is the pre-12/09 URL of `libraries`, redirected the same way.
  capabilities: SHELL_TEXT.route.capabilities,
  project: SHELL_TEXT.route.project,
  tasks: SHELL_TEXT.route.task,
};

/** A root AND everything under it: `/wiki` as well as `/wiki/guides/ci`. Written once, because the
 *  forgotten half is what left the brand title on a subpage. */
const under = (pathname: string, root: string) =>
  pathname === root || pathname.startsWith(`${root}/`);

/** `taches` is the pre-12/09 URL of `tasks`, redirected in a `beforeLoad`. */
const isTaskScreen = (screen: string | undefined) => screen === "tasks" || screen === "taches";

export function pageTitleOf(pathname: string): PageTitle {
  const m = SCREEN.exec(pathname);
  if (m) {
    const [, screen, id] = m;
    if (isTaskScreen(screen) && id) return { title: SHELL_TEXT.route.task, crumb: id };
    // An OPEN goal or agent is named in the singular: an object, no longer a list.
    if (screen === "goals" && id) return { title: SHELL_TEXT.route.goal, crumb: id };
    if (screen === "agents" && id) return { title: SHELL_TEXT.route.agent, crumb: null };
    return { title: PROJECT_SCREENS[screen ?? ""] ?? SHELL_TEXT.brand, crumb: null };
  }
  // `/systeme` is the pre-12/09 URL of `/system`, redirected in a `beforeLoad` (see `railSectionOf`).
  if (under(pathname, "/system") || under(pathname, "/systeme"))
    return { title: SHELL_TEXT.route.system, crumb: null };
  if (under(pathname, "/wiki")) return { title: SHELL_TEXT.route.wiki, crumb: null };
  if (under(pathname, "/concierge")) return { title: CONCIERGE_TEXT.page.title, crumb: null };
  if (pathname.startsWith("/chains/")) return { title: SHELL_TEXT.route.chainRun, crumb: null };
  return { title: SHELL_TEXT.brand, crumb: null };
}
