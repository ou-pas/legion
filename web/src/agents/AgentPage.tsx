// An agent's page, /p/:projectId/agents/:agentId. What TaskPage is to the board: the registry (Agents
// page) is for scanning, this page is for working.
//
// Job description layout (proposal C, 23/08): you come here to reread and correct what the agent
// is, so the role is the page's substance (main column, full reading measure) and engine settings
// and grants are a margin (`SplitPane`, ~300px). The header (name, title, back link, actions) stays
// a full-width row above both columns (`Page` pattern); no action floats in the margin.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate, useParams } from "@tanstack/react-router";
import { Bot, Library, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { agentsApi, type Agent } from "../api/agents.js";
import {
  type McpServer,
  type Rule,
  type SkillInfo,
  type ToolCatalog,
} from "../api/capabilities.js";
import { type Environment } from "../api/environments.js";
import { type RunnerSummary } from "../api/infra.js";
import { type ModelChoice } from "../api/models.js";
import { type Repo, type Secret } from "../api/projects.js";
import {
  bootstrapQuery,
  environmentsQuery,
  mcpServersQuery,
  modelsQuery,
  qk,
  reposQuery,
  rulesQuery,
  runnersQuery,
  secretsQuery,
  skillsQuery,
  tasksQuery,
  toolCatalogQuery,
} from "../queries.js";
import { Banner } from "../ui/banner.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { StatusChip } from "../ui/chip.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { Link } from "../ui/link.js";
import { Page } from "../ui/page.js";
import { SkeletonText } from "../ui/skeleton.js";
import { SplitPane } from "../ui/split.js";
import { Caption, Text } from "../ui/text.js";
import { useBackOrFallback } from "../ui/use-back-or-fallback.js";
import { agentStateKey, draftOf, isDirty, toPatch, type AgentDraft } from "./draft.js";
import { AgentPermissions } from "./permissions.js";
import { AgentRole } from "./role.js";
import { AgentSettings } from "./settings.js";
import { AGENT_TEXT } from "./text.js";

const T = AGENT_TEXT.page;

/** Everything the agent page reads outside the agent: project catalogues, skills, the tool
 *  allowlist and models. Each has an empty default: the page renders while they arrive, and a
 *  missing catalogue is never guessed.
 *
 *  `toolCatalog` stays `undefined` until it answers, on purpose: the grants card's tools group waits
 *  instead of inventing the server allowlist. */
function useAgentCatalogs(projectId: string) {
  const { data: skills = [] } = useQuery(skillsQuery);
  const { data: toolCatalog } = useQuery(toolCatalogQuery);
  const { data: mcpServers = [] } = useQuery(mcpServersQuery(projectId));
  const { data: rules = [] } = useQuery(rulesQuery(projectId));
  const { data: repos = [] } = useQuery(reposQuery(projectId));
  const { data: environments = [] } = useQuery(environmentsQuery(projectId));
  // The whole fleet (v2c, nav): the runner preference is not project-scoped, like the registry
  // itself (schema.runners, no project_id).
  const { data: runners = [] } = useQuery(runnersQuery);
  // Names only: the API never returns a secret value. This page grants a name; decryption happens
  // when the session mounts.
  const { data: secrets = [] } = useQuery(secretsQuery);
  const { data: modelList } = useQuery(modelsQuery);
  return {
    skills,
    toolCatalog,
    mcpServers,
    rules,
    repos,
    environments,
    runners,
    secrets,
    models: modelList?.models ?? [],
    /** The server could not reach the API: the displayed list is the fallback, and the screen says
     *  so rather than present it as the account's truth. */
    modelsAreFallback: modelList?.source === "fallback",
  };
}

export function AgentPage() {
  const { agentId, projectId } = useParams({ from: "/p/$projectId/agents/$agentId" });
  const { data: boot, isLoading } = useQuery(bootstrapQuery);
  const { data: taskData } = useQuery(tasksQuery);
  const agent = boot?.agents.find((a) => a.id === agentId);
  const catalogs = useAgentCatalogs(projectId);

  if (isLoading && !boot) {
    return (
      <Page title={T.title}>
        <Card>
          <SkeletonText lines={5} label={T.loading} />
        </Card>
      </Page>
    );
  }
  if (!agent) {
    return (
      <Page>
        <Empty
          variant="page"
          title={T.missingTitle}
          action={<Link render={(p) => <RouterLink to="/" {...p} />}>{T.backHome}</Link>}
        >
          {T.missingWhy}
        </Empty>
      </Page>
    );
  }

  // Same list as the server (purge.ts → agentLiveSessions): the two guards cannot drift apart. The
  // server's 409 stays the authority if the UI lags behind.
  const live = (taskData?.sessions ?? []).some(
    (s) => s.agentId === agent.id && ACTIVE_STATES.includes(s.status),
  );
  const project = boot?.projects.find((p) => p.id === agent.projectId);

  const defaultSkillNames: string[] = (() => {
    if (!project) return [];
    try {
      return JSON.parse(project.defaultSkillNames) as string[];
    } catch {
      return [];
    }
  })();

  return (
    // `key` = the agent's data identity: the local draft resyncs when server data changes under it
    // (e.g. an MCP server deleted elsewhere, review 5b #9).
    <AgentDetail
      key={agentStateKey(agent)}
      agent={agent}
      live={live}
      skills={catalogs.skills}
      mcpServers={catalogs.mcpServers}
      rules={catalogs.rules}
      repos={catalogs.repos}
      secrets={catalogs.secrets.filter((s) => s.projectId === agent.projectId)}
      environments={catalogs.environments}
      runners={catalogs.runners}
      toolCatalog={catalogs.toolCatalog}
      models={catalogs.models}
      modelsAreFallback={catalogs.modelsAreFallback}
      defaultModel={project?.defaultModel ?? ""}
      defaultSkillNames={defaultSkillNames}
    />
  );
}

function AgentDetail({
  agent,
  live,
  skills,
  mcpServers,
  rules,
  repos,
  secrets,
  environments,
  runners,
  toolCatalog,
  models,
  modelsAreFallback,
  defaultModel,
  defaultSkillNames,
}: {
  agent: Agent;
  live: boolean;
  skills: SkillInfo[];
  mcpServers: McpServer[];
  rules: Rule[];
  repos: Repo[];
  secrets: Secret[];
  environments: Environment[];
  runners: RunnerSummary[];
  /** Not loaded (`undefined`): the grants card's tools group waits instead of guessing the server
   *  allowlist. */
  toolCatalog: ToolCatalog | undefined;
  models: ModelChoice[];
  modelsAreFallback: boolean;
  defaultModel: string;
  defaultSkillNames: string[];
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<AgentDraft>(() => draftOf(agent));
  const set = (patch: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = isDirty(agent, draft);

  const save = useMutation({
    mutationFn: () => agentsApi.patchAgent(agent.id, toPatch(draft)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.bootstrap }),
  });
  // Promotion failure used to go through `alert()`. An error reads in the page, with the rest.
  const promote = useMutation({
    mutationFn: () => agentsApi.promoteAgent(agent.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agent-templates"] }),
  });
  // The close button goes back (`history.back()`) when you came from the registry or elsewhere in
  // the app, and falls back to the registry only on direct arrival, same rule as a task's close
  // button (ui/use-back-or-fallback.ts).
  const backToRegistry = useBackOrFallback(
    () => void navigate({ to: "/p/$projectId/agents", params: { projectId: agent.projectId } }),
  );

  return (
    <Page
      object
      title={
        <>
          {agent.name}
          {!agent.inboxAccess && (
            <StatusChip state="wait" dot={false} size="sm">
              {AGENT_TEXT.chip.noInbox}
            </StatusChip>
          )}
          {live && (
            <StatusChip state="run" size="sm">
              {AGENT_TEXT.chip.inSession}
            </StatusChip>
          )}
        </>
      }
      sub={
        <Row gap={6} wrap>
          <Text size="sm" tone="muted">
            {agent.title}
          </Text>
          <Link
            render={(p) => (
              <RouterLink
                to="/p/$projectId/agents"
                params={{ projectId: agent.projectId }}
                {...p}
              />
            )}
          >
            {T.backToRegistry}
          </Link>
        </Row>
      }
      actions={
        <Row gap={6} align="center">
          {dirty && <Caption tone="wait">{T.unsaved}</Caption>}
          <Button
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {T.save}
          </Button>
          <Button
            leading={<Library size={13} />}
            loading={promote.isPending}
            onClick={() => promote.mutate()}
          >
            {T.promote}
          </Button>
          <IconBtn title={T.close} onClick={backToRegistry}>
            <X size={14} />
          </IconBtn>
        </Row>
      }
    >
      {/* A fallback list looks exactly like the real one: unsaid, you configure aliases believing
          you are choosing among the models actually available. */}
      {modelsAreFallback && (
        <Banner tone="wait" title={T.fallbackTitle}>
          {T.fallbackWhy}
        </Banner>
      )}
      {save.isError && <FormError>{String((save.error as Error).message)}</FormError>}
      {promote.isError && <FormError>{String((promote.error as Error).message)}</FormError>}
      {promote.isSuccess && (
        <Banner tone="ok" title={T.promotedTitle}>
          {T.promotedWhy}
        </Banner>
      )}

      {/* Main column: the job description, the role read in full and in comfort. Margin: engine
          (compact, rare settings folded) then grants (dense checkable grants, read-only ones
          summarised as a count). */}
      <SplitPane
        label={T.paneLabel}
        main={
          <Card icon={<Bot size={16} />} title={T.roleCard}>
            <AgentRole agent={agent} live={live} />
          </Card>
        }
        aside={
          <Stack gap={12}>
            <Card icon={<SlidersHorizontal size={16} />} title={T.engineCard}>
              <AgentSettings
                agent={agent}
                models={models}
                environments={environments}
                runners={runners}
                defaultModel={defaultModel}
                draft={draft}
                set={set}
              />
            </Card>
            <Card icon={<ShieldCheck size={16} />} title={T.grantsCard}>
              <AgentPermissions
                agent={agent}
                skills={skills}
                mcpServers={mcpServers}
                rules={rules}
                repos={repos}
                secrets={secrets}
                toolCatalog={toolCatalog}
                draft={draft}
                set={set}
                defaultSkillNames={defaultSkillNames}
              />
            </Card>
          </Stack>
        }
      />
    </Page>
  );
}
