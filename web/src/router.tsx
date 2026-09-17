// Code-based route tree — router registered for global type inference (skill ts-register-router).
// Each project is scoped by the URL (/p/$projectId/...); System, wiki and concierge are global. No
// hidden "active project": the project comes from the path.
import { QueryClient, useQuery } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
  useMatchRoute,
  useRouterState,
  HeadContent,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Book, Settings } from "lucide-react";
import { CrashPage } from "./app/crash-page.js";
import { SHELL_TEXT } from "./app/text/shell.js";
import { UI_TEXT } from "./ui/vocabulary.js";
import { IconButton } from "./ui/button.js";
import { Link as UiLink } from "./ui/link.js";
import {
  AppShell,
  IconRail,
  Logo,
  MainArea,
  ShellBody,
  TopBar,
  TopBarTitle,
  TopBarTools,
} from "./ui/shell.js";
import { RailSlot, railSectionOf, type RailSection } from "./app/rail-slot.js";
import { ProjectTabBar } from "./projects/project-tab-bar.js";
import { SystemTabBar } from "./system/system-tab-bar.js";
import { WikiTabBar } from "./wiki/wiki-tab-bar.js";
import { ConciergeTabBar } from "./concierge/concierge-tab-bar.js";
import { pageTitleOf } from "./app/page-title.js";
// Tab titles live in `app/view-title.ts`: without them `document.title` was "Legion" on every route,
// making history, tabs and page change announcements useless (WCAG 2.4.2, a11y audit P1).
import { title, viewTitle } from "./app/view-title.js";
import { Divider } from "./ui/divider.js";
import { SystemRailNav } from "./system/system-rail.js";
import { SYSTEM_TEXT } from "./system/text.js";
import { WikiRailNav } from "./wiki/wiki-rail.js";
import { WIKI_TEXT } from "./wiki/text.js";
import { useRail } from "./ui/use-rail.js";
import { Empty } from "./ui/empty.js";
import { Page } from "./ui/page.js";
import { ToastProvider } from "./ui/toast.js";
import { ThemeProvider } from "./ui/theme.js";
import { Spinner } from "./ui/spinner.js";
import { CHANNELS_TEXT } from "./channels/text.js";
// Section document titles: the SAME word as the rail and the screen header. Three places name a
// section, so one catalog names it.
import { CAPABILITIES_PAGE_TEXT } from "./capabilities/text/page.js";
import { CRATE_TEXT } from "./portability/text.js";
import { PROJECT_PAGE_TEXT } from "./projects/text/project-page.js";
import { SESSION_RUNTIME_TEXT } from "./projects/text/session-runtime.js";

import {
  bootstrapQuery,
  goalQuery,
  inboxQuery,
  pendingByProjectQuery,
  taskQuery,
  tasksQuery,
} from "./queries.js";
import { useControlEvents } from "./events/use-control-events.js";
import { parseTaskView, TASK_VIEW_PATH, type TaskView } from "./tasks/task-views.js";
import { chainRunSteps } from "./chains/chain-run.js";
import { TASK_PAGE_TEXT } from "./tasks/text/task-page.js";
import { INTERVIEW_TEXT } from "./interviews/text.js";
import { TaskAbsent } from "./tasks/task-absent.js";
import { Spacer } from "./ui/flex.js";
import {
  NewProjectModal,
  ProjectLayout,
  ProjectRailNav,
  readLastProjectId,
  useProject,
} from "./projects/project.js";
import { NoProject } from "./projects/no-project.js";
import { ProjectRail } from "./projects/project-rail.js";
import { TopBarProjectSwitch } from "./projects/top-bar-project-switch.js";
import { PendingButton, PendingPanel, type EntryRender } from "./inbox/pending-panel.js";
import { ConciergeButton } from "./concierge/concierge-button.js";
import { CONCIERGE_TEXT } from "./concierge/text.js";
import { pendingGroups } from "./inbox/pending-entries.js";
import { TopBarStatus } from "./app/top-bar.js";
import { CommandPaletteProvider } from "./app/CommandPalette.js";
import { versionQueryOptions } from "./infra/version-query.js";
import { VersionChip } from "./app/version-chip.js";
import { UpdateReturnBanner } from "./infra/update-return-banner.js";
import { SearchButton, ThemeToggle, NotifToggle } from "./app/top-bar-actions.js";
import {
  AgentPage,
  AgentsPage,
  AnalyticsPage,
  Board,
  BriefScreen,
  CapabilitiesPage,
  CapabilityChainsScreen,
  ChainRunPage,
  ChannelsPage,
  ConciergePage,
  CrateScreen,
  CriteriaScreen,
  DangerScreen,
  ReposScreen,
  EnvironmentsScreen,
  GeneralScreen,
  GoalPage,
  GoalsPage,
  InboxPage,
  InboxQuestionScreen,
  InfraPage,
  InterviewScreen,
  IssuesPage,
  LogsPage,
  McpScreen,
  ModelRoutingScreen,
  NotesScreen,
  PrScreen,
  ProjectGeneralScreen,
  ProjectPage,
  ProjectIntegrationsScreen,
  ProjectSecretsScreen,
  ReportScreen,
  ReviewsPage,
  RulesScreen,
  RuntimeScreen,
  SchedulesPage,
  SkillsScreen,
  SystemPage,
  TaskArtifactsScreen,
  TaskPage,
  TimelineScreen,
  WikiScreen,
} from "./app/screens.js";

export const queryClient = new QueryClient();

/** Where a waiting panel row leads (07/09): a ROUND to its page, everything else to its task.
 *  `pending-entries.ts` decides (`entry.question`); the panel does not know the router, it says what to
 *  open, and the link is built here. Outside `Layout`, since it reads nothing of the shell. */
const pendingLink: EntryRender = (entry, props) =>
  entry.question ? (
    <Link to="/p/$projectId/inbox/$inboxId" params={entry.question} {...props} />
  ) : (
    <Link
      to="/p/$projectId/tasks/$taskId"
      params={{ projectId: entry.projectId, taskId: entry.taskId }}
      {...props}
    />
  );

/** The open section's sub-navigation, or `null` where there is none: that `null` removes the rail AND
 *  its reopen pill, since there would be nothing to reopen. */
function railNavOf(section: RailSection): ReactNode | null {
  if (section === "project") return <ProjectRailNav />;
  if (section === "system") return <SystemRailNav />;
  if (section === "wiki") return <WikiRailNav />;
  return null;
}

/** The phone tab bar: where-you-are navigation laid flat (13/09). Same switch as `railNavOf`, on
 *  purpose: rail and bar show the SAME list, and two tables chosen in two places would drift.
 *
 *  `null` has no bar: the no-project preflight is already the root, with no exit to offer. The
 *  concierge does get one despite having no sub-navigation (16/09): a one-target bar is no sub-menu,
 *  but it is the only exit of an installed app, which has no back button.
 *
 *  Whether the bar shows is NOT decided here: CSS decides at the `compact` breakpoint
 *  (`app/tab-bar.css`); a prop would double it. */
function TabBarSlot({ section }: { section: RailSection }) {
  if (section === "project") return <ProjectTabBar />;
  if (section === "system") return <SystemTabBar />;
  if (section === "wiki") return <WikiTabBar />;
  if (section === "concierge") return <ConciergeTabBar />;
  return null;
}

/** The open CONTEXT's name, not the product's: the pill shows it when the rail is collapsed, and
 *  "Legion" would not say what reopens. */
function railNameOf(section: RailSection, projectName: string | undefined): string {
  if (section === "project") return projectName ?? SHELL_TEXT.brand;
  if (section === "system") return SYSTEM_TEXT.title;
  if (section === "wiki") return WIKI_TEXT.title;
  return SHELL_TEXT.brand;
}

function Layout() {
  // The event stream, opened once for the whole app (02/09). At the root for the same reason as
  // `ThemeProvider` and `ToastProvider` below: the only place where "one instance" is a guarantee. It
  // renders nothing and turns server events into cache invalidations (`events/use-control-events.ts`).
  useControlEvents();
  // The channels view is the only one taking the content area EDGE TO EDGE: it holds the viewport height
  // so its thread scrolls alone and its composer sticks to the bottom. The ROUTER decides edge to edge,
  // not shared state.
  const matchRoute = useMatchRoute();
  // `fuzzy`: the view has TWO routes, the list and a channel named in the URL (`/channels/$taskId`).
  // Without it, opening a channel by direct link left edge to edge.
  const inChannels = Boolean(matchRoute({ to: "/p/$projectId/channels", fuzzy: true }));
  // Rail collapse is app state: it describes how one looks, not where one is, hence a hook rather than
  // the URL (ui/use-rail.ts).
  const { collapsed: railCollapsed, toggle: toggleRail } = useRail();
  const { data } = useQuery(tasksQuery);
  const { data: inbox = [] } = useQuery(inboxQuery);
  // The icon rail: projects come from the bootstrap, what stops them from its own route (slice nav/02).
  // The creation modal is mounted HERE because its trigger is the rail's "+" button, part of no page.
  const { data: boot } = useQuery(bootstrapQuery);
  const { data: pending } = useQuery(pendingByProjectQuery);
  const { project, projectId } = useProject();
  const [creating, setCreating] = useState(false);
  // Thirty minutes normally, three seconds during an update (`infra/version-query.ts`): the SAME query
  // as the Version panel, at the root.
  const { data: version } = useQuery(versionQueryOptions);
  // The button count: the sum of per-project counts, never a second computation, or a project badge and
  // the bar figure would one day disagree.
  const pendingTotal = Object.values(pending ?? {}).reduce((a, b) => a + b, 0);
  const hasProjects = (boot?.projects ?? []).length > 0;
  // What the rail shows: the navigation of where you are. `null` (e.g. the no-project screen) removes
  // the rail AND its reopen pill.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = railSectionOf(pathname);
  // The screen name at the head of the bar (04/09): a pure function of the path, like the rail.
  const heading = pageTitleOf(pathname);
  const railNav = railNavOf(section);
  const railName = railNameOf(section, project?.name);

  return (
    // One toast stack for the whole app, mounted above the shell.
    <ThemeProvider>
      <ToastProvider>
        <CommandPaletteProvider>
          {/* HeadContent applies the active route's `head`: without it `document.title` stayed
            "Legion" everywhere. */}
          <HeadContent />
          <AppShell>
            {/* The bar, in mockup order (direction-double-nav, variant B). It received everything
              global the rail carried (29/08): the rail held two axes at once. */}
            <TopBar>
              {/* The SCREEN, not the brand (04/09, "flat" mockup): the brand heads the icon rail, the
                bar says where you are, in the same place on every route. */}
              {/* Switching project from the bar, at the phone breakpoint only (14/09): both rails
                leave the flow there, leaving NO path between projects. Same menu as the rail head
                (`projects/project-switch.tsx`), never a second list. */}
              <TopBarProjectSwitch />
              <TopBarTitle crumb={heading.crumb}>{heading.title}</TopBarTitle>
              <Spacer />
              {/* Without a project, machine state is IN the page (the preflight), not doubled in the
                bar ("no project" mockup). */}
              {/* The inbox travels as a SLOT in the status group (02/09); its count is the CROSS total
                of per-project counts. The button stays an inbox domain object the bar composes
                without knowing. */}
              {/* Tools fold below the phone breakpoint (14/09, operator request): five families do
                not fit 393px. Above it `TopBarTools` is `display: contents`, so the bar is
                unchanged. */}
              <TopBarTools>
                {/* Wiki and System reachable on a phone (14/09). On a wide screen they live at the
                  FOOT of the icon rail, which leaves the flow at the compact breakpoint, so no path
                  to them remained. They go here rather than in the bottom bar, which carries where
                  you ARE. Folded with the tools, so invisible on a wide screen. */}
                <span className="ui-topbar-poste">
                  <IconButton
                    title={SHELL_TEXT.topbar.wiki}
                    variant="quiet"
                    render={(p) => <Link to="/wiki" {...p} />}
                  >
                    <Book size={17} />
                  </IconButton>
                  <IconButton
                    title={SHELL_TEXT.topbar.system}
                    variant="quiet"
                    render={(p) => <Link to="/system/general" {...p} />}
                  >
                    <Settings size={17} />
                  </IconButton>
                </span>
                {hasProjects && (
                  <TopBarStatus
                    pendingSlot={
                      <PendingButton count={pendingTotal}>
                        <PendingPanel
                          groups={pendingGroups({
                            inbox,
                            tasks: data?.tasks ?? [],
                            projects: boot?.projects ?? [],
                          })}
                          render={pendingLink}
                        />
                      </PendingButton>
                    }
                  />
                )}
                {/* The available version, PUT IN THE WAY (26/08): System › General shows it, but
                nobody goes there when all looks normal. A chip, not a banner: being behind is not a
                failure (`app/version-chip.tsx`). */}
                <VersionChip version={version} />
                {/* Rules between groups (04/09): without them five families on one line read as a
                single row of icons. */}
                <Divider orientation="vertical" space="sm" />
                <SearchButton />
                {/* The concierge (29/08): a panel, like the waiting panel, not a place one goes. */}
                <ConciergeButton />
                {/* On wide screens wiki and System live at the FOOT of the icon rail (04/09): they set
                up the workstation, not the screen. */}
                {/* The two TOGGLES lead nowhere, so they are not navigation entries: icon buttons with
                a pressed state, as the mockup draws. */}
                <Divider orientation="vertical" space="sm" />
                <ThemeToggle />
                <NotifToggle />
                {/* No avatar (13/09, operator request): an initial identifies nobody with a single
                operator, and it cost a whole bar ROW at the compact breakpoint. The `ui/shell.tsx`
                component stays for the day Legion knows several people. */}
              </TopBarTools>
            </TopBar>
            {/* The update return is visible everywhere (02/09): mounted under the bar, it survives any
              page change (`infra/update-return-banner.tsx`). */}
            <UpdateReturnBanner />
            <ShellBody>
              {/* No project rail without a project ("no project" mockup: a single-column body). */}
              {/* Projects, one square each (slice nav/02). This rail carries identity: the
                neighbouring rail can change or disappear without losing where you are. */}
              {/* The strip is always there (04/09), even without project: brand at the head, System
                and wiki at the foot, reachable BEFORE having a project (declare a machine, read how
                to start). Project squares keep their rule: none without projects. */}
              <IconRail
                label={SHELL_TEXT.iconRail}
                mark={
                  <UiLink variant="inherit" render={(props) => <Link to="/" {...props} />}>
                    <Logo />
                  </UiLink>
                }
                foot={
                  <>
                    <IconButton
                      title={SHELL_TEXT.topbar.wiki}
                      variant="quiet"
                      render={(p) => <Link to="/wiki" {...p} />}
                    >
                      <Book size={17} />
                    </IconButton>
                    {/* System is a ROUTE (behaviour 6) leading to the screen gathering its sections. */}
                    <IconButton
                      title={SHELL_TEXT.topbar.system}
                      variant="quiet"
                      render={(p) => <Link to="/system/general" {...p} />}
                    >
                      <Settings size={17} />
                    </IconButton>
                  </>
                }
              >
                {hasProjects && (
                  <ProjectRail
                    projects={boot?.projects ?? []}
                    currentId={projectId}
                    pending={pending}
                    onAdd={() => setCreating(true)}
                    render={(p, props) => (
                      <Link to="/p/$projectId/board" params={{ projectId: p.id }} {...props} />
                    )}
                  />
                )}
              </IconRail>
              {/* The rail carries the navigation of where you are (slice nav/05), chosen by
                `railSectionOf` from the path alone (`app/rail-slot.tsx`). */}
              <RailSlot
                nav={railNav}
                collapsed={railCollapsed}
                name={railName}
                onToggle={toggleRail}
              />
              <MainArea bleed={inChannels}>
                <Outlet />
              </MainArea>
            </ShellBody>
            {/* Outside `ShellBody`: the tab bar is the shell's last ROW, not a body column. */}
            <TabBarSlot section={section} />
            {creating && <NewProjectModal onClose={() => setCreating(false)} />}
          </AppShell>
        </CommandPaletteProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Layout });

// Global routes. The root is not a screen but a switch (nav work, behaviour 9): the global dashboard
// aggregated all projects while work is project-scoped, and what it carried now lives in the bar.
// One lands in the LAST open project (remembered by `ProjectLayout`); without any project, on the
// preflight.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NoProject,
  head: title(SHELL_TEXT.route.noProject),
  // `beforeLoad`, not `loader`: the redirect must happen BEFORE the route component is chosen, or the
  // preflight flashes on an installation that has projects.
  beforeLoad: async ({ context }) => {
    const boot = await context.queryClient.ensureQueryData(bootstrapQuery);
    if (boot.projects.length === 0) return;
    // The last visited project if it still exists: a stale id (deleted project) falls back to the first
    // rather than "not found" on app open.
    const last = readLastProjectId();
    const target = boot.projects.find((p) => p.id === last) ?? boot.projects[0]!;
    throw redirect({ to: "/p/$projectId/board", params: { projectId: target.id } });
  },
});

// The three old System URLs, kept as REDIRECTS (slice nav/05). The sections live under `/system`; these
// paths appear in server error messages, and removing them would break links. One canonical URL per
// screen, or the rail would not know which to light.
const infraRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/infra",
  beforeLoad: () => {
    throw redirect({ to: "/system/runners" });
  },
});
const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
  beforeLoad: () => {
    throw redirect({ to: "/system/logs" });
  },
});
// Two routes for one screen: `/wiki` opens the corpus home, `/wiki/$slug` a given page. Without the
// first, a link to "the wiki" would need the home slug.
const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki",
  component: WikiScreen,
  head: title(SHELL_TEXT.route.wiki),
});
const wikiPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki/$slug",
  component: WikiScreen,
  head: title(SHELL_TEXT.route.wiki),
});
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  beforeLoad: () => {
    throw redirect({ to: "/system/analytics" });
  },
});
// System and its sections as ROUTES (behaviour 6, slice nav/05): as tabs they were unreachable by link
// and invisible to the back button.
// Bare `/system` REDIRECTS to `/system/general` rather than rendering it in place: with two URLs for one
// screen the rail only lit General on one of them. French paths became English on 12/09 (`infra` →
// `runners`, `journal` → `logs`, `statistiques` → `analytics`); the old URLs still redirect, see
// further below.
const systemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system",
  component: SystemPage,
  head: title(SHELL_TEXT.route.system),
});
const systemIndexRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/system/general", replace: true });
  },
});
const systemInfraRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: "runners",
  component: InfraPage,
  head: title(SHELL_TEXT.route.infra),
});
const systemLogsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: "logs",
  component: LogsPage,
  head: title(SHELL_TEXT.route.logs),
});
const systemStatsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: "analytics",
  component: AnalyticsPage,
  head: title(SHELL_TEXT.route.analytics),
});
const systemGeneralRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: "general",
  component: GeneralScreen,
  head: title(SYSTEM_TEXT.tab.general),
});
// The five old French URLs, redirecting straight to the canonical one (same pattern as `/infra`,
// `/logs`, `/analytics` above, which point to `/system/...` directly rather than bouncing twice).
// `replace: true` everywhere, or the redirect step stays in history.
const systemeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/systeme",
  beforeLoad: () => {
    throw redirect({ to: "/system/general", replace: true });
  },
});
const systemeInfraRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/systeme/infra",
  beforeLoad: () => {
    throw redirect({ to: "/system/runners", replace: true });
  },
});
const systemeJournalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/systeme/journal",
  beforeLoad: () => {
    throw redirect({ to: "/system/logs", replace: true });
  },
});
const systemeStatistiquesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/systeme/statistiques",
  beforeLoad: () => {
    throw redirect({ to: "/system/analytics", replace: true });
  },
});
const systemeGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/systeme/general",
  beforeLoad: () => {
    throw redirect({ to: "/system/general", replace: true });
  },
});

// The concierge (12/09), a global route like System and the wiki: it spans all projects. The bar hover
// panel stays and leads here: the quick question from anywhere, and the place to come back to.
//
// One page, no rail (09/09 audit): brief and conversation list share `ConciergePage`; opening a
// conversation navigates to the SIBLING route `/concierge/$conversationId`, like `/wiki` + `/wiki/$slug`.
// A conversation keeps its URL: a thread one cannot reload, send or find with back only lasts an instant.
const conciergeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/concierge",
  component: ConciergePage,
  head: title(CONCIERGE_TEXT.page.title),
});
const conciergeConversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/concierge/$conversationId",
  component: ConciergePage,
  head: title(CONCIERGE_TEXT.page.title),
});
// The two old URLs REDIRECT, like /infra, /logs, /analytics: no code link targets them
// (NAV_REDIRECT_TARGETS, scripts/arch-metrics.ts), but a bookmark or pasted link still works.
// `replace: true`, or back falls onto the redirect step.
const conciergeConversationsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/concierge/conversations",
  beforeLoad: () => {
    throw redirect({ to: "/concierge", replace: true });
  },
});
const conciergeConversationOldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/concierge/conversations/$conversationId",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/concierge/$conversationId",
      params,
      replace: true,
    });
  },
});

// A task's old URL, now a REDIRECT (slice nav/13). The page lives under its project; about twenty links
// still point here (a task's blocker, the task another waits for, a session seen from Infra), and most
// lack the `projectId`. Asking them for it would spread a parameter across half the screen; they keep
// working at the cost of a round trip.
//
// Like `/infra`, `/logs` and `/analytics`, except it needs DATA to know where to go, so it reads the
// task list first. `replace: true`, or back falls onto the redirect step. `search: true` keeps a pasted
// link's `?vue=`, revalidated by the canonical route.
//
// An id designating nothing redirects NOWHERE: it renders the absence page. A URL built with an unknown
// project would produce a second error masking the first.
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  component: TaskAbsent,
  head: title(SHELL_TEXT.route.task),
  beforeLoad: async ({ context, params }) => {
    const { tasks } = await context.queryClient.ensureQueryData(tasksQuery);
    const task = tasks.find((t) => t.id === params.taskId);
    if (!task) return;
    throw redirect({
      to: "/p/$projectId/tasks/$taskId",
      params: { projectId: task.projectId, taskId: task.id },
      search: true,
      replace: true,
    });
  },
});

// Same family as /tasks/$taskId: the short URL stays served (palette, inventory links, pasted links)
// and redirects to the canonical route UNDER the project, which carries a rail (operator finding,
// 02/09: a goal page had no navigation). An unknown id redirects nowhere: GoalPage renders its absence
// state.
const goalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/goals/$goalId",
  component: GoalPage,
  head: title(SHELL_TEXT.route.goal),
  beforeLoad: async ({ context, params }) => {
    const goal = await context.queryClient
      .ensureQueryData(goalQuery(params.goalId))
      .catch(() => null);
    if (!goal) return;
    throw redirect({
      to: "/p/$projectId/goals/$goalId",
      params: { projectId: goal.projectId, goalId: goal.id },
      replace: true,
    });
  },
});
const pGoalRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "goals/$goalId",
  component: GoalPage,
  head: title(SHELL_TEXT.route.goal),
});

// A chain run's flow. Same family as /tasks/$taskId: until 15/09 the route stayed GLOBAL because a chain
// already carries its project, true of the model and false of the screen, since the RAIL comes from
// the project (operator finding). It redirects like a task, a goal and an agent.
//
// The project is read from the run's FIRST step, as `ChainRunPage` shows: a run's tasks share their
// project. An id designating nothing redirects nowhere: `ChainRunPage` renders its absence state.
const chainRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chains/$runId",
  component: ChainRunPage,
  head: title(SHELL_TEXT.route.chainRun),
  beforeLoad: async ({ context, params }) => {
    const { tasks } = await context.queryClient.ensureQueryData(tasksQuery);
    const step = chainRunSteps(tasks, params.runId)[0];
    if (!step) return;
    throw redirect({
      to: "/p/$projectId/chains/$runId",
      params: { projectId: step.projectId, runId: params.runId },
      replace: true,
    });
  },
});

/** A run's CANONICAL route: under the project, so with its rail. */
const pChainRunRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "chains/$runId",
  component: ChainRunPage,
  head: title(SHELL_TEXT.route.chainRun),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(bootstrapQuery),
      context.queryClient.ensureQueryData(tasksQuery),
    ]),
});

// An agent's old URL, now a REDIRECT (agents.project_id is NOT NULL): /agents/$agentId →
// /p/$projectId/agents/$agentId, like tasks. An unknown id renders the 404 page; a URL built with an
// unknown project would produce a second error masking the first. `replace: true`, or the redirect step
// stays in history.
const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents/$agentId",
  head: title(SHELL_TEXT.route.agent),
  beforeLoad: async ({ context, params }) => {
    const { agents } = await context.queryClient.ensureQueryData(bootstrapQuery);
    const agent = agents.find((a) => a.id === params.agentId);
    if (!agent) throw notFound();
    throw redirect({
      to: "/p/$projectId/agents/$agentId",
      params: { projectId: agent.projectId, agentId: agent.id },
      search: true,
      replace: true,
    });
  },
});

// Project-scoped routes: /p/$projectId/...
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
  component: ProjectLayout,
  // An unknown project id (stale bookmark, deleted project) → "not found", not a silent all-projects
  // view (review IA #2).
  loader: async ({ context, params }) => {
    const boot = await context.queryClient.ensureQueryData(bootstrapQuery);
    if (!boot.projects.some((p) => p.id === params.projectId)) throw notFound();
    return boot;
  },
});

const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/board", params });
  },
});

const pBoardRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "board",
  component: Board,
  head: title(SHELL_TEXT.route.board),
});
// Channels view (25/08): a SECOND reading of the same data, next to the board. Path in English since
// 12/09 (`canaux` → `channels`), see the two redirects below.
const pChannelsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "channels",
  component: ChannelsPage,
  head: title(CHANNELS_TEXT.page.title),
});
/** The open channel lives IN the URL (26/08, operator request): otherwise no link returned to a
 *  conversation and a reload lost it. Like `/wiki` and `/wiki/$slug`: a sibling route, not a child, since
 *  the page has no `<Outlet>` and renders whole from its param. */
const pChannelRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "channels/$taskId",
  component: ChannelsPage,
  head: title(CHANNELS_TEXT.page.title),
});
// The two old French URLs, redirecting straight to the new one, like System above. `replace: true`, or
// the redirect step stays in history.
const pCanauxRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "canaux",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/channels", params, replace: true });
  },
});
const pCanalRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "canaux/$taskId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/channels/$taskId", params, replace: true });
  },
});
// A task's CANONICAL URL (slice nav/13). `tasks.project_id` is `NOT NULL REFERENCES projects(id)`: a task
// belongs to a project by database constraint. The global URL said otherwise, and the rail disappeared
// on a task page (`railSectionOf` returns `null` outside `/p/`) while the icon rail highlighted the
// project. `railSectionOf` did not change: the route starts with `/p/`. Making the rail depend on loaded
// data would flicker it during the request.
//
// Since slice 17 it is a PARENT route: each view has its path segment, so a pasteable link, a working
// back button and a document title. The page renders its head then an `<Outlet />`.
//
// Path in English since 12/09 (`taches` → `tasks`); the old URL and its views redirect, see the
// `taches…` block below.
const pTaskRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "tasks/$taskId",
  component: TaskPage,
  head: title(SHELL_TEXT.route.task),
  /** `?vue=diff` has been in URLs since slice nav/06, so in bookmarks and messages. The view is now a
   *  path segment, but the param is still READ so the index route knows where to send an old link. An
   *  unknown or absent value is `undefined`: the page never errors on a param a human may have
   *  truncated. */
  //  The key is OPTIONAL in the return type, not just `TaskView | undefined`, or the router would
  //  require a `search` on every task link.
  //  The key is ALWAYS returned, `undefined` included: parent routes validate nothing, so a value not
  //  rewritten here would pass through intact.
  validateSearch: (search: Record<string, unknown>): { vue?: TaskView } => ({
    vue: parseTaskView(search.vue),
  }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(bootstrapQuery),
      context.queryClient.ensureQueryData(tasksQuery),
      // The full record (brief, criteria): the list above only carries the summary since 02/09, see
      // `queries.ts:taskQuery`.
      context.queryClient.ensureQueryData(taskQuery(params.taskId)),
    ]),
});

/** The bare URL resolves, it does not redirect here, except for a legacy `?vue=`, whose target IS fixed.
 *  A task's default view is decided on live data (the thread for an interview, the report if any, the
 *  trace otherwise), one of which derives from the SSE stream living in the page, so `TaskPage`
 *  navigates, with `replace: true`. This component renders nothing: it only exists for one render, and
 *  a placeholder would flicker on each task opening. */
const pTaskIndexRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "/",
  component: () => null,
  beforeLoad: ({ params, search }) => {
    if (!search.vue) return;
    // `replace: true`: otherwise an old `?vue=` link would take two back presses to return to the board.
    throw redirect({ to: TASK_VIEW_PATH[search.vue], params, search: {}, replace: true });
  },
});

const pTaskInterviewRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "interview",
  component: InterviewScreen,
  head: viewTitle(INTERVIEW_TEXT.tab.label),
});
const pTaskReportRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "report",
  component: ReportScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.report),
});
const pTaskTimelineRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "timeline",
  component: TimelineScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.timeline),
});
const pTaskBriefRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "brief",
  component: BriefScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.brief),
});
const pTaskCriteriaRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "criteria",
  component: CriteriaScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.criteria),
});
const pTaskArtifactsRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "artifacts",
  component: TaskArtifactsScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.artifacts),
});
const pTaskPrRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "pr",
  component: PrScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.pr),
});
const pTaskNotesRoute = createRoute({
  getParentRoute: () => pTaskRoute,
  path: "notes",
  component: NotesScreen,
  head: viewTitle(TASK_PAGE_TEXT.views.notes),
});

// A task's old French URL and its views, redirecting straight to the new ones. FLAT routes like
// `pGoalRoute`: a redirect has nothing to offer a child. `search: true` on the bare URL only, which
// carried the legacy `?vue=`; the canonical URL rereads it.
const pTachesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId",
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: "/p/$projectId/tasks/$taskId", params, search, replace: true });
  },
});
const pTachesInterviewRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/interview",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.interview, params, replace: true });
  },
});
const pTachesReportRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/report",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.report, params, replace: true });
  },
});
const pTachesTimelineRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/timeline",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.timeline, params, replace: true });
  },
});
const pTachesBriefRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/brief",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.brief, params, replace: true });
  },
});
const pTachesCriteriaRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/criteria",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.criteria, params, replace: true });
  },
});
const pTachesArtifactsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/artifacts",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.artifacts, params, replace: true });
  },
});
const pTachesPrRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/pr",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.pr, params, replace: true });
  },
});
const pTachesNotesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "taches/$taskId/notes",
  beforeLoad: ({ params }) => {
    throw redirect({ to: TASK_VIEW_PATH.notes, params, replace: true });
  },
});

const pGoalsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "goals",
  component: GoalsPage,
  head: title(SHELL_TEXT.route.goals),
});
const pIssuesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "issues",
  component: IssuesPage,
  head: title(SHELL_TEXT.route.issues),
});
const pReviewsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "reviews",
  component: ReviewsPage,
  head: title(SHELL_TEXT.route.reviews),
});
const pAgentsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "agents",
  component: AgentsPage,
  head: title(SHELL_TEXT.route.agents),
});
// An agent's CANONICAL URL (same story as tasks, nav/13): `agents.project_id` is NOT NULL.
const pAgentRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "agents/$agentId",
  component: AgentPage,
  head: title(SHELL_TEXT.route.agent),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(bootstrapQuery),
      context.queryClient.ensureQueryData(tasksQuery),
    ]),
});

// Project settings and library: one route per section (slice nav/09). A tab is not a URL: no link to
// the crate or MCP servers, no back button.
//
// The two bare URLs stay, redirecting to their first section (they appear in the Agents page, Issues
// and Reviews empty states, and bookmarks). `repos` and `contexte` redirect too since batch nav/2a, their
// content having joined repositories and General. `replace: true` everywhere, or back would be trapped
// on the redirect step.
const sectionTitle = (section: string) => title(`${SHELL_TEXT.route.project} · ${section}`);
const registryTitle = (registry: string) => title(`${SHELL_TEXT.route.capabilities} · ${registry}`);

const pProjectRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "project",
  component: ProjectPage,
  head: title(SHELL_TEXT.route.project),
});
const pProjectIndexRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/project/general", params, replace: true });
  },
});
// Repositories (batch nav/2a): the screen also carries git identity and SSH key, three settings all
// answering "how this project touches git".
const pReposRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "repos",
  component: ReposScreen,
  head: sectionTitle(PROJECT_PAGE_TEXT.tabs.repos),
});
// The old context URL (batch nav/2a), redirecting to General, which absorbed it.
const pContextRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "contexte",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/project/general", params, replace: true });
  },
});
const pGeneralRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "general",
  component: ProjectGeneralScreen,
  head: sectionTitle(PROJECT_PAGE_TEXT.tabs.general),
});
// Path in English since 12/09 (`modeles` → `models`); the old URL redirects.
const pModelsRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "models",
  component: ModelRoutingScreen,
  head: sectionTitle(PROJECT_PAGE_TEXT.tabs.models),
});
const pModelesRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "modeles",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/project/models", params, replace: true });
  },
});
// Merged into Library › Chains (12/09): this URL carried the role → agent mapping (`ChainBindingsCard`),
// and the two screens kept sending to each other. It still redirects:
// `navRedirectLinks` forbids TARGETING it, not serving existing links. Its target is the CURRENT
// destination, not a URL that redirects again.
const pChainsRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "chaines",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/chains", params, replace: true });
  },
});
const pSecretsRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "secrets",
  component: ProjectSecretsScreen,
  head: sectionTitle(PROJECT_PAGE_TEXT.tabs.secrets),
});
// Next to Secrets (15/09): what the project connected outside. Under `/project/`, so the settings rail
// comes by PREFIX.
const pIntegrationsRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "integrations",
  component: ProjectIntegrationsScreen,
  head: sectionTitle(PROJECT_PAGE_TEXT.tabs.integrations),
});
// Path in English since 12/09 (`execution` → `runtime`); the old URL redirects.
const pRuntimeRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "runtime",
  component: RuntimeScreen,
  head: sectionTitle(SESSION_RUNTIME_TEXT.tab),
});
const pExecutionRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "execution",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/project/runtime", params, replace: true });
  },
});
// Path in English since 12/09 (`coffre` → `crate`); the old URL redirects.
const pCrateRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "crate",
  component: CrateScreen,
  head: sectionTitle(CRATE_TEXT.tab),
});
const pCoffreRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "coffre",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/project/crate", params, replace: true });
  },
});
const pDangerRoute = createRoute({
  getParentRoute: () => pProjectRoute,
  path: "danger",
  component: DangerScreen,
  head: sectionTitle(PROJECT_PAGE_TEXT.tabs.danger),
});

// Path renamed on 12/09: `capabilities` → `libraries` (plural like every collection segment), `regles` →
// `rules`. The six old URLs redirect, see the `capabilities…` block after the registries below.
const pCapabilitiesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "libraries",
  component: CapabilitiesPage,
  head: title(SHELL_TEXT.route.capabilities),
});
const pCapabilitiesIndexRoute = createRoute({
  getParentRoute: () => pCapabilitiesRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/skills", params, replace: true });
  },
});
const pSkillsRoute = createRoute({
  getParentRoute: () => pCapabilitiesRoute,
  path: "skills",
  component: SkillsScreen,
  head: registryTitle(CAPABILITIES_PAGE_TEXT.tabs.skills),
});
const pRulesRoute = createRoute({
  getParentRoute: () => pCapabilitiesRoute,
  path: "rules",
  component: RulesScreen,
  head: registryTitle(CAPABILITIES_PAGE_TEXT.tabs.rules),
});
const pCapabilityChainsRoute = createRoute({
  getParentRoute: () => pCapabilitiesRoute,
  path: "chains",
  component: CapabilityChainsScreen,
  head: registryTitle(CAPABILITIES_PAGE_TEXT.tabs.chains),
});
const pMcpRoute = createRoute({
  getParentRoute: () => pCapabilitiesRoute,
  path: "mcp",
  component: McpScreen,
  head: registryTitle(CAPABILITIES_PAGE_TEXT.tabs.mcp),
});
const pEnvironmentsRoute = createRoute({
  getParentRoute: () => pCapabilitiesRoute,
  path: "environments",
  component: EnvironmentsScreen,
  head: registryTitle(CAPABILITIES_PAGE_TEXT.tabs.environments),
});
// The six old URLs, redirecting straight to the new ones. FLAT routes: a redirect has nothing to offer a
// child.
const pCapabilitiesLegacyRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "capabilities",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/skills", params, replace: true });
  },
});
const pSkillsLegacyRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "capabilities/skills",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/skills", params, replace: true });
  },
});
const pRulesLegacyRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "capabilities/regles",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/rules", params, replace: true });
  },
});
const pCapabilityChainsLegacyRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "capabilities/chaines",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/chains", params, replace: true });
  },
});
const pMcpLegacyRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "capabilities/mcp",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/mcp", params, replace: true });
  },
});
const pEnvironmentsLegacyRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "capabilities/environments",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/libraries/environments", params, replace: true });
  },
});
// Scheduled tasks. Path in English since 12/09 (`planifiees` → `scheduled`); the old URL redirects.
const pSchedulesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "scheduled",
  component: SchedulesPage,
  head: title(SHELL_TEXT.route.schedules),
});
const pPlanifieesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "planifiees",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/p/$projectId/scheduled", params, replace: true });
  },
});
// A question has its page (07/09): a multi-field inbox form has room neither in a channel column nor
// under a scrolling thread, so one surface carries it and the others lead there through a card. UNDER
// the project, like `tasks/$taskId`. `inbox` filters the same page on the URL's project, the entry the
// project rail lights (rail-sections.ts). The global `/inbox` was removed (12/09), see
// [[produit/decisions]].
const pInboxRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "inbox",
  component: InboxPage,
  head: title(SHELL_TEXT.route.inbox),
});
const pInboxQuestionRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "inbox/$inboxId",
  component: InboxQuestionScreen,
  head: title(SHELL_TEXT.route.inbox),
});

/** Exported for tests: the REAL route tree, to check it serves the URLs the rail shows. A tree copied
 *  into a test would only prove its own consistency. */
export const routeTree = rootRoute.addChildren([
  indexRoute,
  infraRoute,
  logsRoute,
  analyticsRoute,
  systemRoute.addChildren([
    systemIndexRoute,
    systemInfraRoute,
    systemLogsRoute,
    systemStatsRoute,
    systemGeneralRoute,
  ]),
  systemeRoute,
  systemeInfraRoute,
  systemeJournalRoute,
  systemeStatistiquesRoute,
  systemeGeneralRoute,
  conciergeRoute,
  conciergeConversationRoute,
  conciergeConversationsListRoute,
  conciergeConversationOldRoute,
  wikiRoute,
  wikiPageRoute,
  taskRoute,
  goalRoute,
  chainRunRoute,
  agentRoute,
  projectRoute.addChildren([
    projectIndexRoute,
    pBoardRoute,
    pChannelsRoute,
    pChannelRoute,
    pCanauxRoute,
    pCanalRoute,
    pTaskRoute.addChildren([
      pTaskIndexRoute,
      pTaskInterviewRoute,
      pTaskReportRoute,
      pTaskTimelineRoute,
      pTaskBriefRoute,
      pTaskCriteriaRoute,
      pTaskArtifactsRoute,
      pTaskPrRoute,
      pTaskNotesRoute,
    ]),
    pTachesRoute,
    pTachesInterviewRoute,
    pTachesReportRoute,
    pTachesTimelineRoute,
    pTachesBriefRoute,
    pTachesCriteriaRoute,
    pTachesArtifactsRoute,
    pTachesPrRoute,
    pTachesNotesRoute,
    pGoalsRoute,
    pGoalRoute,
    pChainRunRoute,
    pIssuesRoute,
    pReviewsRoute,
    pSchedulesRoute,
    pPlanifieesRoute,
    pAgentsRoute,
    pAgentRoute,
    pInboxRoute,
    pInboxQuestionRoute,
    pProjectRoute.addChildren([
      pProjectIndexRoute,
      pGeneralRoute,
      pReposRoute,
      pContextRoute,
      pModelsRoute,
      pModelesRoute,
      pChainsRoute,
      pSecretsRoute,
      pIntegrationsRoute,
      pRuntimeRoute,
      pExecutionRoute,
      pCrateRoute,
      pCoffreRoute,
      pDangerRoute,
    ]),
    pCapabilitiesRoute.addChildren([
      pCapabilitiesIndexRoute,
      pSkillsRoute,
      pRulesRoute,
      pCapabilityChainsRoute,
      pMcpRoute,
      pEnvironmentsRoute,
    ]),
    pCapabilitiesLegacyRoute,
    pSkillsLegacyRoute,
    pRulesLegacyRoute,
    pCapabilityChainsLegacyRoute,
    pMcpLegacyRoute,
    pEnvironmentsLegacyRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
  // While a screen chunk arrives. This ALSO creates the <Suspense> boundary around each route: without
  // `pendingComponent`, TanStack renders a bare fragment and a suspending deferred screen would bubble
  // to the root, hiding the whole shell during the download (Match.tsx, `canWrapInSuspense`). One router
  // default is enough.
  // The broken screen (14/09). Otherwise TanStack's white "Something went wrong" leaves an installed app,
  // which has no address bar, with no way out.
  //
  // On the router, not around everything: it only replaces the ROUTE, so both bars survive.
  //
  // It also handles the most frequent case, not a bug: after an update an open page requests a screen
  // chunk the new build no longer serves (hashed names). The import fails and `CrashPage` recognises it
  // (`app/crash.ts`).
  defaultErrorComponent: ({ error }) => <CrashPage error={error} />,
  defaultPendingComponent: () => (
    <Page>
      <Spinner size="lg" label={UI_TEXT.loading} />
    </Page>
  ),
  defaultNotFoundComponent: () => (
    <Page>
      <Empty
        variant="page"
        title={SHELL_TEXT.notFound.title}
        action={
          <UiLink render={(p) => <Link to="/" {...p} />}>{SHELL_TEXT.notFound.action}</UiLink>
        }
      >
        {SHELL_TEXT.notFound.body}
      </Empty>
    </Page>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router; // skill ts-register-router
  }
}
