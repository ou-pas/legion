// Query layer — hierarchical array keys (skill rule qk-hierarchical-organization),
// SSE events invalidate instead of duplicating state.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { bootstrapApi } from "./api/bootstrap.js";
import { capabilitiesApi } from "./api/capabilities.js";
import { connectionsApi } from "./api/connections.js";
import { environmentsApi } from "./api/environments.js";
import { goalsApi } from "./api/goals.js";
import { inboxApi } from "./api/inbox.js";
import { infraApi, type ControlEventLevel } from "./api/infra.js";
import { modelsApi } from "./api/models.js";
import { projectsApi } from "./api/projects.js";
import { tasksApi } from "./api/tasks.js";
import { wikiApi } from "./api/wiki.js";
import { useToast } from "./ui/toast.js";
import { SHELL_TEXT } from "./app/text/shell.js";

/** The safety net, no longer the engine (02/09). These lists refreshed every 4 s: on an idle task page,
 *  75 requests per minute per viewer, 7 MB/min for `/api/tasks` alone. The event stream (`events/`) now
 *  keeps them fresh by invalidating the exact key when the server knows something.
 *
 *  The interval STAYS on purpose: a stream dying silently (proxy cut, tab waking from sleep, restarted
 *  server) must not blind the screen. One minute is the worst delay accepted then, against four seconds
 *  paid all the time otherwise. */
const NET_MS = 60_000;

export const qk = {
  bootstrap: ["bootstrap"] as const,
  tasks: ["tasks"] as const,
  inbox: ["inbox"] as const,
  pendingByProject: ["inbox", "pending-by-project"] as const,
  /** UNDER `inbox` on purpose (07/09): the event stream already invalidates this prefix on
   *  `inbox_answer` and `inbox_draft`, so a question page switches to read mode and reloads its draft
   *  with no extra invalidation line or per-page SSE. The server signal carries no item id: the prefix
   *  does the work, at the cost of refetching the queue too. */
  inboxQuestion: (id: string) => ["inbox", "question", id] as const,
  artifacts: (taskId: string) => ["artifacts", taskId] as const,
  /** The PREFIX of all artifact lists, used by the event stream (`events/`) when a signal has no task:
   *  one list refetched too many beats an artifact invisible until the next safety net. */
  allArtifacts: ["artifacts"] as const,
  /** Brief attachments, next to artifacts and not inside: neither the same interval nor the same
   *  signals (no agent writes them). */
  attachments: (taskId: string) => ["attachments", taskId] as const,
  /** UNDER `tasks` on purpose: `useInvalidateLive` already invalidates this prefix, so a task deposited
   *  during the session shows in the lineage without its own refresh interval. */
  taskLinks: (taskId: string) => ["tasks", "links", taskId] as const,
  /** A task's full record (02/09 cut: the list no longer carries brief and criteria). UNDER `tasks`,
   *  same reason as `taskLinks` above. */
  task: (taskId: string) => ["tasks", "detail", taskId] as const,
  taskLot: (taskId: string) => ["tasks", "lot", taskId] as const,
  goals: (projectId: string) => ["goals", projectId] as const,
  goal: (id: string) => ["goals", "detail", id] as const,
  goalFootprint: (id: string) => ["goals", "footprint", id] as const,
  infra: ["infra"] as const,
  /** The short fleet list, OUTSIDE the `infra` prefix, which holds the full docker read: different cost
   *  and rhythm. */
  runners: ["runners"] as const,
  skills: ["skills"] as const,
  toolCatalog: ["tool-catalog"] as const,
  mcpServers: (projectId: string) => ["mcp-servers", projectId] as const,
  environments: (projectId: string) => ["environments", projectId] as const,
  rules: (projectId: string) => ["rules", projectId] as const,
  repos: (projectId: string) => ["repos", projectId] as const,
  /** UNDER `repos` on purpose: adding or removing a repository changes what the list offers (the
   *  "already declared" mark), and the existing invalidation handles it. */
  availableRepos: (projectId: string) => ["repos", projectId, "available"] as const,
  secrets: ["secrets"] as const,
  connections: (projectId: string) => ["connections", projectId] as const,
  projectCredentials: (id: string) => ["project-credentials", id] as const,
  gitIdentityCheck: (id: string) => ["git-identity-check", id] as const,
  projectImage: (projectId: string) => ["project-image", projectId] as const,
  controlEvents: (level: string, limit: number) => ["control-events", level, limit] as const,
  /** The concierge brief. NO periodic refresh: each computation is a model call, started only by a
   *  gesture (see concierge/ConciergePage.tsx). */
  conciergeBrief: ["concierge", "brief"] as const,
  conciergeConversations: ["concierge", "conversations"] as const,
  conciergeConversation: (id: string) => ["concierge", "conversations", id] as const,
};

/** Names only: the API never returns a secret's value, so nothing sensitive enters the browser cache. */
export const secretsQuery = queryOptions({
  queryKey: qk.secrets,
  queryFn: () => projectsApi.secrets(),
});

/** A project's ORDERED Claude credentials, and which wins. Apart from `secretsQuery`, a different
 *  question: that one lists what was set, this one gives ORDER, exhaustion and which serves, including
 *  the control plane's, which is in no list. Shared by the Claude credentials card and `SecretsCard`,
 *  which only needs the verdict (`.active`). */
export const projectCredentialsQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.projectCredentials(projectId),
    queryFn: () => projectsApi.credentials(projectId),
    enabled: projectId.length > 0,
  });
/** The model list comes from the SDK, not a constant. It moves on a scale of weeks: generous client
 *  `staleTime`, 6 h server cache. */
export const modelsQuery = queryOptions({
  queryKey: ["models"] as const,
  queryFn: () => modelsApi.models(),
  staleTime: 30 * 60_000,
});

/** Will the configured address be attributed to an account? The FORGE answers, slowly and fallibly: it
 *  never blocks the screen and is not refetched at each glance. Saving an identity invalidates it
 *  explicitly, the only moment it changes. */
export const gitIdentityCheckQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.gitIdentityCheck(projectId),
    queryFn: () => projectsApi.gitIdentityCheck(projectId),
    enabled: projectId.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const reposQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.repos(projectId),
    queryFn: () => projectsApi.repos(projectId),
    enabled: projectId.length > 0,
  });

/** Discovery talks to the network: not redone on each card mount, and an unreachable forge is not
 *  retried three times under the operator's eyes; the screen has a button for that, and a way out. */
export const availableReposQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.availableRepos(projectId),
    queryFn: () => projectsApi.availableRepos(projectId),
    enabled: projectId.length > 0,
    staleTime: 60_000,
    retry: false,
  });

/** A project's connections, read by two screens: the Integrations tab, which shows them, and the
 *  repositories card, which reads declared instances so it stops asking the forge of a host a
 *  connection already names. The list only moves on connecting. */
export const connectionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.connections(projectId),
    queryFn: () => connectionsApi.list(projectId),
    enabled: projectId.length > 0,
    staleTime: 30_000,
  });

export const rulesQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.rules(projectId),
    queryFn: () => capabilitiesApi.rules(projectId),
    enabled: projectId.length > 0,
  });

export const skillsQuery = queryOptions({
  queryKey: qk.skills,
  queryFn: () => capabilitiesApi.skills(),
  staleTime: 60_000,
});
/** The tool allowlist comes from the SERVER, not a copied constant: it only moves with a control plane
 *  version, hence the generous `staleTime`. */
export const toolCatalogQuery = queryOptions({
  queryKey: qk.toolCatalog,
  queryFn: () => capabilitiesApi.toolCatalog(),
  staleTime: 30 * 60_000,
});
export const mcpServersQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.mcpServers(projectId),
    queryFn: () => capabilitiesApi.mcpServers(projectId),
    enabled: projectId.length > 0,
  });
export const environmentsQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.environments(projectId),
    queryFn: () => environmentsApi.environments(projectId),
    enabled: projectId.length > 0,
  });

// 60 s at the root (badge); the Infra page itself goes to 10 s (docker ps on ssh:// hosts every 10 s
// all the time would be waste: review 5a #4).
export const infraQuery = queryOptions({
  queryKey: qk.infra,
  queryFn: () => infraApi.infra(),
  refetchInterval: 60_000,
});

/** The short fleet list (v66), to choose a task's machine. An interval rather than a generous
 *  `staleTime`: "does the machine answer?" is exactly what changes while watching (a Mac just woken).
 *  No docker behind it: the registry and the probe's last verdict. */
export const runnersQuery = queryOptions({
  queryKey: qk.runners,
  queryFn: () => infraApi.runners(),
  refetchInterval: 30_000,
});

/** Control plane log: a list one browses, not a stream. 20 s keep it fresh without a scrolling
 *  terminal feel. */
export const controlEventsQuery = (level: ControlEventLevel | "all", limit: number) =>
  queryOptions({
    queryKey: qk.controlEvents(level, limit),
    queryFn: () => infraApi.controlEvents({ level: level === "all" ? undefined : level, limit }),
    refetchInterval: 20_000,
  });

export const goalsQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.goals(projectId),
    queryFn: () => goalsApi.goals(projectId),
    refetchInterval: NET_MS,
    enabled: projectId.length > 0,
  });
export const goalQuery = (id: string) =>
  queryOptions({ queryKey: qk.goal(id), queryFn: () => goalsApi.goal(id), refetchInterval: 3_000 });
/** What deletion would destroy, loaded apart from the goal: no interval (the page invalidates it
 *  afterwards), and a goal that does not exist yet does not ask (`enabled`). */
export const goalFootprintQuery = (id: string) =>
  queryOptions({
    queryKey: qk.goalFootprint(id),
    queryFn: () => goalsApi.goalFootprint(id),
    enabled: id.length > 0,
  });

export const bootstrapQuery = queryOptions({
  queryKey: qk.bootstrap,
  queryFn: bootstrapApi.bootstrap,
  staleTime: 60_000,
});
export const tasksQuery = queryOptions({
  queryKey: qk.tasks,
  queryFn: tasksApi.tasks,
  refetchInterval: NET_MS,
});
/** A task's full record (brief, criteria). The list no longer carries these fields since 02/09, so the
 *  task page asks here for its one task. Same safety net as the list (`NET_MS`): a task kept open must
 *  stay fresh even if the SSE stream drops. */
export const taskQuery = (taskId: string) =>
  queryOptions({
    queryKey: qk.task(taskId),
    queryFn: () => tasksApi.task(taskId),
    enabled: taskId.length > 0,
    refetchInterval: NET_MS,
  });
export const inboxQuery = queryOptions({
  queryKey: qk.inbox,
  queryFn: inboxApi.inbox,
  refetchInterval: NET_MS,
});
// Read WITH the bootstrap by the icon rail, but live like the inbox: a gate opening while watching must
// light the project badge without reloading.
export const pendingByProjectQuery = queryOptions({
  queryKey: qk.pendingByProject,
  queryFn: inboxApi.pendingByProject,
  refetchInterval: NET_MS,
});
/** A single question, for its page (07/09). No interval: the event stream moves it by invalidating the
 *  `inbox` prefix on `inbox_answer` and `inbox_draft`. Window focus refetches too (React Query default),
 *  as the mockup asks: reload on open and focus, no per-keystroke broadcast. */
export const inboxQuestionQuery = (inboxId: string) =>
  queryOptions({
    queryKey: qk.inboxQuestion(inboxId),
    queryFn: () => inboxApi.question(inboxId),
    enabled: inboxId.length > 0,
  });
/** NOTICES: what waits for nobody. Shared by the inbox page and the logs (slice nav/03): two
 *  `queryOptions` for one route would drift by an interval. */
export const noticesQuery = queryOptions({
  queryKey: ["notices"] as const,
  queryFn: () => inboxApi.notices(),
  refetchInterval: 30_000,
});
/** The wiki INDEX: titles, not pages. It only moves with a repo commit, hence one hour of freshness;
 *  the palette reads it on each opening. */
export const wikiIndexQuery = queryOptions({
  queryKey: ["wiki"] as const,
  queryFn: wikiApi.index,
  staleTime: 60 * 60_000,
});
// Live like tasks/inbox: artifacts arrive DURING and above all AT THE END of a session (pr.md is written
// last). Without an interval the list froze at mount: on an open task page the task reached review
// with neither the create-PR button nor the PR tab showing (operator feedback, 23/08, FqmV90FIfH).
export const artifactsQuery = (taskId: string) =>
  queryOptions({
    queryKey: qk.artifacts(taskId),
    queryFn: () => tasksApi.artifacts(taskId),
    refetchInterval: NET_MS,
  });

/** Brief attachments. NO interval, unlike artifacts: they only move through an operator gesture on this
 *  screen (no agent writes them), and mutations invalidate. */
export const attachmentsQuery = (taskId: string) =>
  queryOptions({ queryKey: qk.attachments(taskId), queryFn: () => tasksApi.attachments(taskId) });

/** A task's lineage. NO interval: it only moves when an agent deposits a task (`propose_task`) or a
 *  child is committed, both already going through `useInvalidateLive` on the `tasks` prefix. */
export const taskLinksQuery = (taskId: string) =>
  queryOptions({ queryKey: qk.taskLinks(taskId), queryFn: () => tasksApi.taskLinks(taskId) });

/** The batch proposed by a breakdown step, read from DISK on each call: a new deposit replaces the
 *  previous, and the batch present at approval counts (behaviour 4). No long cache; `enabled` comes
 *  from the caller, since only a chain step in review has a reason to ask. */
export const taskLotQuery = (taskId: string, enabled: boolean) =>
  queryOptions({
    queryKey: qk.taskLot(taskId),
    queryFn: () => tasksApi.taskLot(taskId),
    enabled,
    staleTime: 0,
  });

/** Returns its promise (16/09): a button that acts then invalidates (`use-task-actions.tsx`) must be
 *  able to wait for invalidation, not just the HTTP response, or its spinner stops before the screen
 *  changes. Callers with no use for it (an SSE handler, a `() => void` callback) ignore it for free. */
export function useInvalidateLive() {
  const qc = useQueryClient();
  return (taskId?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.tasks }),
      qc.invalidateQueries({ queryKey: qk.inbox }),
      ...(taskId ? [qc.invalidateQueries({ queryKey: qk.artifacts(taskId) })] : []),
    ]);
}

export function useReplyInbox() {
  const invalidate = useInvalidateLive();
  const { push } = useToast();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { choiceId?: string; text?: string; formData?: Record<string, unknown> };
    }) => inboxApi.replyInbox(id, body),
    // Without onError a failure (e.g. repo/secret preflight) was silent: the reopened question came back
    // unchanged with no reason (same convention as use-kanban-dnd.ts for the Kanban).
    onError: (err: Error) =>
      push({ tone: "bad", title: SHELL_TEXT.answerRefused, body: err.message }),
    onSettled: () => invalidate(),
  });
}
