// What the project rail lists, and at which level.
//
// Settings and Library used to carry eight and five tabs. A tab is not an address: no link to the
// crate, no back button. System made that move in nav slice 05.
//
// The rail replaces itself (`direction-sous-menu-rail.html`, variant A, anchored in the head). In
// a section it shows the section, not the project and the section. The accepted cost: no one-click
// jump from Crate to Board. Two things make up for it: the rail head writes `<project> · <section>`
// (the only place still saying which project you are in), and a "← Project" row leads back. The
// arrow names its destination, as everywhere else, which is why the section is written in the head
// and not in that row.
//
// The table lives here, not in `project.tsx`, because it decides two things at once: what the rail
// shows and which routes it points to. Splitting them would allow showing an entry the router does
// not serve, the defect `make contract` catches for the API and nothing catches for navigation.
import {
  AlarmClock,
  AlignLeft,
  ArrowLeft,
  BookMarked,
  Bot,
  Cable,
  CircleDot,
  ClipboardCheck,
  Container,
  FileText,
  FolderGit2,
  Globe,
  GitPullRequest,
  Info,
  KeyRound,
  LayoutGrid,
  Lock,
  MessagesSquare,
  Package,
  Plug,
  Route,
  Settings,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  TriangleAlert,
  Workflow,
  Inbox,
} from "lucide-react";
import { CHANNELS_TEXT } from "../channels/text.js";
import { CAPABILITIES_PAGE_TEXT } from "../capabilities/text/page.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { CRATE_TEXT } from "../portability/text.js";
import { TASK_VIEW_PATH } from "../tasks/task-views.js";
import { TASK_PAGE_TEXT } from "../tasks/text/task-page.js";
import { PROJECT_PAGE_TEXT } from "./text/project-page.js";
import { SESSION_RUNTIME_TEXT } from "./text/session-runtime.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";

/** The row going up a level. It heads both section lists rather than being added at render: a rail
 *  list is data, and a row existing only at mount would be invisible to the test checking what the
 *  section shows. */
const BACK = {
  to: "/p/$projectId/board",
  label: PROJECT_TEXT.rail.back,
  Icon: ArrowLeft,
  back: true,
} as const;

// The project rail entries, in mock-up order (direction-double-nav, variant B). `to` as literals for
// TanStack type safety; `group` carries the heading opening the section (the mock-up's three groups,
// the first untitled because it starts the column). Labels come from the domain vocabulary: the
// same entry is named here, in the tab title and in the palette.
//
// "Settings" and "Library" point at their first section, not the bare address: that still exists
// but redirects, and routing every rail click through a redirect adds a history step to a daily
// gesture.
export const PROJECT_ROWS = [
  { to: "/p/$projectId/board", label: PROJECT_TEXT.rail.board, Icon: LayoutGrid },
  // Right under the board, on purpose: both read the same work, one by state, the other by time.
  { to: "/p/$projectId/channels", label: CHANNELS_TEXT.nav, Icon: MessagesSquare },
  // The project inbox (07/09). A question's page lives under `/p/<project>/inbox/…`; without this
  // row the rail had nothing to light up and "Pull requests" ended up marked.
  { to: "/p/$projectId/inbox", label: PROJECT_TEXT.rail.inbox, Icon: Inbox },
  { to: "/p/$projectId/goals", label: PROJECT_TEXT.rail.goals, Icon: Target },
  // The screen existed since PR #50 without being mounted anywhere: no route, no rail entry. A
  // screen no path reaches does not exist, even when its files are there.
  { to: "/p/$projectId/scheduled", label: PROJECT_TEXT.rail.schedules, Icon: AlarmClock },
  {
    to: "/p/$projectId/reviews",
    label: PROJECT_TEXT.rail.reviews,
    Icon: GitPullRequest,
    group: PROJECT_TEXT.rail.review,
  },
  { to: "/p/$projectId/issues", label: PROJECT_TEXT.rail.issues, Icon: CircleDot },
  {
    to: "/p/$projectId/agents",
    label: PROJECT_TEXT.rail.agents,
    Icon: Bot,
    group: PROJECT_TEXT.rail.configure,
  },
  {
    to: "/p/$projectId/libraries/skills",
    label: PROJECT_TEXT.rail.capabilities,
    Icon: Sparkles,
  },
  // "The project" became "Settings" (29/08): the bar's gear sets up the machine, this one the
  // project. Two scopes, two places, two words.
  { to: "/p/$projectId/project/general", label: PROJECT_TEXT.rail.settings, Icon: Settings },
] as const;

/** The eight Settings subjects (nav batch 2a: eight tabs grouped by database table became seven
 *  grouped by the question asked; Integrations made the eighth on 15/09): what the project is
 *  (General), how it touches git (Repositories), its keys (Secrets), what it connected outside
 *  (Integrations), which model it runs (Models), what its sessions run with (Sessions), its crate,
 *  its deletion.
 *
 *  Context went into General, and Chains too: its role → agent mapping merged into Library's Chains
 *  registry, under each installed chain; it was the same setting shown in two places pointing at
 *  each other. Their routes still redirect; see `NAV_REDIRECT_TARGETS`
 *  in `scripts/arch-metrics.ts`. */
export const SETTINGS_ROWS = [
  BACK,
  { to: "/p/$projectId/project/general", label: PROJECT_PAGE_TEXT.tabs.general, Icon: Info },
  { to: "/p/$projectId/project/repos", label: PROJECT_PAGE_TEXT.tabs.repos, Icon: FolderGit2 },
  { to: "/p/$projectId/project/secrets", label: PROJECT_PAGE_TEXT.tabs.secrets, Icon: KeyRound },
  // Right after Secrets, because both read together: what you connect, and what you pasted. `Cable`
  // and not `Plug`: `Plug` already marks the MCP registry in `CAPABILITY_ROWS`, and two navigation
  // rows with the same icon get confused in a narrow rail.
  {
    to: "/p/$projectId/project/integrations",
    label: PROJECT_PAGE_TEXT.tabs.integrations,
    Icon: Cable,
  },
  { to: "/p/$projectId/project/models", label: PROJECT_PAGE_TEXT.tabs.models, Icon: Route },
  { to: "/p/$projectId/project/runtime", label: SESSION_RUNTIME_TEXT.tab, Icon: Container },
  { to: "/p/$projectId/project/crate", label: CRATE_TEXT.tab, Icon: Lock },
  { to: "/p/$projectId/project/danger", label: PROJECT_PAGE_TEXT.tabs.danger, Icon: TriangleAlert },
] as const;

/** Library's five registries (renamed from Capabilities on 12/09; the word keeps its wiki meaning,
 *  what is granted to an agent). The Chains duplicate with Settings merged here: the row below now
 *  carries, under each installed chain, the agent holding each role. Environments stays a row: the
 *  work removing it (decision of 08/09, network wall) is not done, and the module, its routes and
 *  `agents.environment_id` are still there; removing the row alone would make a ghost.
 *
 *  Paths are English since 12/09 (nav project, batch 5): `capabilities` became `libraries`,
 *  following the label, plural like the repository's other collection segments; `regles` became
 *  `rules`. */
export const CAPABILITY_ROWS = [
  BACK,
  {
    to: "/p/$projectId/libraries/skills",
    label: CAPABILITIES_PAGE_TEXT.tabs.skills,
    Icon: Sparkles,
  },
  {
    to: "/p/$projectId/libraries/rules",
    label: CAPABILITIES_PAGE_TEXT.tabs.rules,
    Icon: BookMarked,
  },
  {
    to: "/p/$projectId/libraries/chains",
    label: CAPABILITIES_PAGE_TEXT.tabs.chains,
    Icon: Workflow,
  },
  { to: "/p/$projectId/libraries/mcp", label: CAPABILITIES_PAGE_TEXT.tabs.mcp, Icon: Plug },
  {
    to: "/p/$projectId/libraries/environments",
    label: CAPABILITIES_PAGE_TEXT.tabs.environments,
    Icon: Globe,
  },
] as const;

/** A task's views (nav slice 17). Nine tabs on a card reaching the ninth block of a stack, plus the
 *  criteria as a permanent panel: the app's last `<TabList>`. A horizontal bar cannot name a group,
 *  and these entries are three families the code comments stated without being able to show.
 *  Number and structure decide here, not slice 09's rule ("distinct subject → route, another view →
 *  tab"): Crate and Repositories are two views of a project just as Diff and Brief are two views of
 *  a task, and the former became addresses.
 *
 *  Rows are static, like Settings', for a reason: `railRowsFor` is a pure function of the path and
 *  cannot know a report exists (`hasReport` derives from the SSE stream living in the page). Rather
 *  than lift page state up to the rail, all rows are always there and an empty view says so. A menu
 *  whose entries do not move beats one that does.
 *
 *  The accepted loss: the old tab bar's counters (rounds, events, artifacts, open review comments,
 *  notes) do not appear here; restoring them would need exactly the state lifting refused above.
 *
 *  Paths come from `tasks/task-views.ts`, not copied: rail and router read the same table, so the
 *  rail cannot point to a route that does not exist. */
export const TASK_ROWS = [
  BACK,
  {
    to: TASK_VIEW_PATH.brief,
    label: TASK_PAGE_TEXT.views.brief,
    Icon: FileText,
    group: TASK_PAGE_TEXT.views.groups.contract,
  },
  { to: TASK_VIEW_PATH.criteria, label: TASK_PAGE_TEXT.views.criteria, Icon: ClipboardCheck },
  {
    to: TASK_VIEW_PATH.interview,
    label: INTERVIEW_TEXT.tab.label,
    Icon: MessagesSquare,
    group: TASK_PAGE_TEXT.views.groups.flow,
  },
  { to: TASK_VIEW_PATH.report, label: TASK_PAGE_TEXT.views.report, Icon: AlignLeft },
  { to: TASK_VIEW_PATH.timeline, label: TASK_PAGE_TEXT.views.timeline, Icon: Timer },
  { to: TASK_VIEW_PATH.notes, label: TASK_PAGE_TEXT.views.notes, Icon: StickyNote },
  {
    to: TASK_VIEW_PATH.artifacts,
    label: TASK_PAGE_TEXT.views.artifacts,
    Icon: Package,
    group: TASK_PAGE_TEXT.views.groups.delivery,
  },
  // "Diff" is no longer a row (05/09): the diff reads in the PR view, under the draft. The file
  // count pill (`task-facts.ts`) follows on that row.
  { to: TASK_VIEW_PATH.pr, label: TASK_PAGE_TEXT.views.pr, Icon: GitPullRequest },
  // "Settings" is no longer a row (04/09): settings live in the page's right panel, open by default
  // until the task runs (`tasks/task-inspector.tsx`). The `/settings` route was removed (nav project,
  // batch G, 12/09).
] as const;

export type RailRow =
  | (typeof PROJECT_ROWS)[number]
  | (typeof SETTINGS_ROWS)[number]
  | (typeof CAPABILITY_ROWS)[number]
  | (typeof TASK_ROWS)[number];

/** The first segment under `/p/<id>`, the one naming the screen. `null` on bare `/p/<id>`, where no
 *  screen is chosen yet (the router redirects to the board). */
const SCREEN = /^\/p\/[^/]+\/([^/]+)/;

/** What the rail shows at this address. A pure function of the path, as `railSectionOf` already
 *  decides which rail shows: "which list, and which second segment in the head" has one answer per
 *  URL, and a three-line table reads and tests at once.
 *
 *  A section's bare address (`/p/x/project`) already renders the section's list: it redirects to
 *  its first entry, but the redirect runs in a `beforeLoad`, so the path exists for an instant, and
 *  a flickering rail costs more than a table row. */
export function railRowsFor(pathname: string): { sub: string | null; rows: readonly RailRow[] } {
  const screen = SCREEN.exec(pathname)?.[1];
  if (screen === "project") return { sub: PROJECT_TEXT.rail.settings, rows: SETTINGS_ROWS };
  // `capabilities` besides `libraries` (nav project, batch 5, 12/09): the old address redirects in
  // a `beforeLoad`, so it exists for an instant.
  if (screen === "libraries" || screen === "capabilities")
    return { sub: PROJECT_TEXT.rail.capabilities, rows: CAPABILITY_ROWS };
  // A task replaces the project list, like a section (nav slice 17). The bare `/p/x/tasks/<id>`
  // already renders this list: it resolves to a view from the page, so it exists for one render.
  // `taches` besides `tasks` (nav project, batch 5, 12/09): the old address redirects in a
  // `beforeLoad`, so it too exists for an instant.
  if (screen === "tasks" || screen === "taches")
    return { sub: PROJECT_TEXT.rail.task, rows: TASK_ROWS };
  return { sub: null, rows: PROJECT_ROWS };
}
