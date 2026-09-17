// Deferred screens, one chunk per screen. The route tree stays in `router.tsx` (tests mount it);
// this module only owns how each screen's code arrives.
//
// Everything used to be imported statically: 881 KB in one `index-*.js`, react-diff-view, dnd-kit
// and the wiki renderer included, downloaded even to read the inbox. `lazyRouteComponent` carries a
// `.preload()` that `defaultPreload: "intent"` fires on link hover, so the chunk is almost always
// there by the click. The shell (rail, top bar, palette) is NOT deferred: it is on screen on every
// route, splitting it would only make it arrive later.
import { lazyRouteComponent } from "@tanstack/react-router";

export const InboxPage = lazyRouteComponent(() => import("../inbox/InboxPage.js"), "InboxPage");
// A question's page (07/09) has its own chunk: it embeds the whole questionnaire, which the list has
// no reason to download.
export const InboxQuestionScreen = lazyRouteComponent(
  () => import("../inbox/InboxQuestionPage.js"),
  "InboxQuestionPage",
);
export const InfraPage = lazyRouteComponent(() => import("../infra/InfraPage.js"), "InfraPage");
export const LogsPage = lazyRouteComponent(() => import("../infra/LogsPage.js"), "LogsPage");
export const WikiScreen = lazyRouteComponent(() => import("../wiki/WikiPage.js"), "WikiScreen");
export const AnalyticsPage = lazyRouteComponent(
  () => import("../sessions/AnalyticsPage.js"),
  "AnalyticsPage",
);
export const TaskPage = lazyRouteComponent(() => import("../tasks/TaskPage.js"), "TaskPage");
export const GoalPage = lazyRouteComponent(() => import("../goals/GoalPage.js"), "GoalPage");
export const ChainRunPage = lazyRouteComponent(
  () => import("../chains/ChainRunPage.js"),
  "ChainRunPage",
);
export const AgentPage = lazyRouteComponent(() => import("../agents/AgentPage.js"), "AgentPage");
export const Board = lazyRouteComponent(() => import("../tasks/Board.js"), "Board");
export const ChannelsPage = lazyRouteComponent(
  () => import("../channels/ChannelsPage.js"),
  "ChannelsPage",
);
export const GoalsPage = lazyRouteComponent(() => import("../goals/GoalsPage.js"), "GoalsPage");
export const IssuesPage = lazyRouteComponent(
  () => import("../integrations/IssuesPage.js"),
  "IssuesPage",
);
export const ReviewsPage = lazyRouteComponent(
  () => import("../review/ReviewsPage.js"),
  "ReviewsPage",
);
export const ProjectPage = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "ProjectPage",
);
export const AgentsPage = lazyRouteComponent(() => import("../agents/AgentsPage.js"), "AgentsPage");
export const CapabilitiesPage = lazyRouteComponent(
  () => import("../capabilities/CapabilitiesPage.js"),
  "CapabilitiesPage",
);
// Project settings sections and library registries (slice nav/09): they were tabs, and a tab is not
// a URL. Each group comes from one module.
export const ProjectGeneralScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "ProjectGeneralScreen",
);
export const ReposScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "ReposScreen",
);
export const ModelRoutingScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "ModelRoutingScreen",
);
export const ProjectSecretsScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "SecretsScreen",
);
export const ProjectIntegrationsScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "IntegrationsScreen",
);
export const RuntimeScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "RuntimeScreen",
);
export const CrateScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "CrateScreen",
);
export const DangerScreen = lazyRouteComponent(
  () => import("../projects/ProjectPage.js"),
  "DangerScreen",
);
export const SkillsScreen = lazyRouteComponent(
  () => import("../capabilities/CapabilitiesPage.js"),
  "SkillsScreen",
);
export const RulesScreen = lazyRouteComponent(
  () => import("../capabilities/CapabilitiesPage.js"),
  "RulesScreen",
);
export const CapabilityChainsScreen = lazyRouteComponent(
  () => import("../capabilities/CapabilitiesPage.js"),
  "ChainsScreen",
);
export const McpScreen = lazyRouteComponent(
  () => import("../capabilities/CapabilitiesPage.js"),
  "McpScreen",
);
export const EnvironmentsScreen = lazyRouteComponent(
  () => import("../capabilities/CapabilitiesPage.js"),
  "EnvironmentsScreen",
);
export const SchedulesPage = lazyRouteComponent(
  () => import("../schedules/SchedulesPage.js"),
  "SchedulesPage",
);
export const SystemPage = lazyRouteComponent(() => import("../system/SystemPage.js"), "SystemPage");
export const GeneralScreen = lazyRouteComponent(
  () => import("../system/GeneralScreen.js"),
  "GeneralScreen",
);
// A task's views (slice nav/17), in their own chunk apart from the page shell: the shell carries the
// SSE stream, so it must not reload when switching views.
export const InterviewScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "InterviewScreen",
);
export const ReportScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "ReportScreen",
);
export const TimelineScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "TimelineScreen",
);
export const BriefScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "BriefScreen",
);
export const CriteriaScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "CriteriaScreen",
);
export const TaskArtifactsScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "ArtifactsScreen",
);
export const PrScreen = lazyRouteComponent(() => import("../tasks/task-screens.js"), "PrScreen");
export const NotesScreen = lazyRouteComponent(
  () => import("../tasks/task-screens.js"),
  "NotesScreen",
);
// One screen for both concierge routes (`/concierge`, `/concierge/$conversationId`), 12/09.
export const ConciergePage = lazyRouteComponent(
  () => import("../concierge/ConciergePage.js"),
  "ConciergePage",
);
