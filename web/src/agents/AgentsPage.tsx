// Agents: the project registry, one row per agent, for scanning. Settings (role, model, effort,
// thinking, grants) live on the dedicated /agents/:agentId page, like board → TaskPage. Each agent
// used to be a full card: readable at three, untenable at twenty (operator's decision, 23/08).
// The agent library (cross-project templates) stays here, under the list.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Library, Plus, Trash2 } from "lucide-react";
import { Link as RouterLink } from "@tanstack/react-router";
import { agentsApi } from "../api/agents.js";
import { bootstrapQuery, qk, tasksQuery } from "../queries.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { Code } from "../ui/code.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { SearchInput } from "../ui/input.js";
import { Link } from "../ui/link.js";
import { List, ListRow } from "../ui/list.js";
import { Page } from "../ui/page.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Caption, Text } from "../ui/text.js";
import { Toolbar } from "../ui/toolbar.js";
import { AgentRow } from "./agent-row.js";
import { useProject } from "../projects/project.js";
import { CapabilitiesLink } from "./links.js";
import { AGENT_TEXT } from "./text.js";

const T = AGENT_TEXT.registry;

export function AgentsPage() {
  const { data: boot, isLoading } = useQuery(bootstrapQuery);
  const { data: taskData } = useQuery(tasksQuery);
  const { project, projectId } = useProject();
  const [filter, setFilter] = useState("");

  // Sorted by name: at twenty agents, database insertion order is not a reading order.
  const agents = (boot?.agents ?? [])
    .filter((a) => !project || a.projectId === project.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const needle = filter.trim().toLowerCase();
  const shown =
    needle === ""
      ? agents
      : agents.filter((a) => `${a.name} ${a.title}`.toLowerCase().includes(needle));
  // Same list as the server (purge.ts → agentLiveSessions): the registry's "in session" pill and
  // the detail page's edit refusal read the same truth.
  const liveAgentIds = new Set(
    (taskData?.sessions ?? [])
      .filter((s) => ACTIVE_STATES.includes(s.status))
      .map((s) => s.agentId),
  );

  return (
    <Page
      title={T.title}
      sub={
        <>
          {T.sub}{" "}
          <CapabilitiesLink projectId={projectId ?? ""} tab="skills">
            {T.subLinkLabel}
          </CapabilitiesLink>
          .
        </>
      }
    >
      <Stack gap={14}>
        <Card icon={<Bot size={16} />} title={T.cardTitle}>
          <Stack gap={8}>
            {/* The filter only appears once useful: at two agents a search field is furniture.
                It lives in a Toolbar's `end`, the only DS container sized on its content: in the
                card header, a `width: 100%` field would crush the title. */}
            {agents.length > 2 && (
              <Toolbar
                label={T.filterLabel}
                variant="ruled"
                end={
                  <SearchInput
                    value={filter}
                    onValueChange={setFilter}
                    aria-label={T.filterFieldLabel}
                    placeholder={T.filterPlaceholder}
                  />
                }
              >
                <Caption>{T.shown(shown.length, agents.length)}</Caption>
              </Toolbar>
            )}
            {isLoading && <SkeletonText lines={4} label={T.loading} />}
            {!isLoading && agents.length === 0 && (
              <Empty variant="panel" title={T.emptyTitle}>
                {T.emptyWhy}
              </Empty>
            )}
            {!isLoading && agents.length > 0 && shown.length === 0 && (
              <Empty
                variant="panel"
                art="filtered"
                title={T.noMatchTitle}
                action={
                  <Button variant="quiet" onClick={() => setFilter("")}>
                    {T.clearFilter}
                  </Button>
                }
              >
                {T.noMatch(filter, agents.length)}
              </Empty>
            )}
            {shown.length > 0 && (
              <List label={T.listLabel}>
                {shown.map((a) => (
                  <Link
                    key={a.id}
                    variant="inherit"
                    render={(p) => (
                      <RouterLink
                        to="/p/$projectId/agents/$agentId"
                        params={{ projectId: projectId ?? "", agentId: a.id }}
                        {...p}
                      />
                    )}
                  >
                    <AgentRow agent={a} live={liveAgentIds.has(a.id)} />
                  </Link>
                ))}
              </List>
            )}
          </Stack>
        </Card>
        <TemplateLibrary projectAgentNames={agents.map((a) => a.name)} />
      </Stack>
    </Page>
  );
}

// Agent library (v11): cross-project templates. Role and settings travel; grants (folders, env,
// secrets) stay per project.
function TemplateLibrary({ projectAgentNames }: { projectAgentNames: string[] }) {
  const { project } = useProject();
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ["agent-templates"] as const,
    queryFn: () => agentsApi.agentTemplates(),
  });
  const [error, setError] = useState("");
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["agent-templates"] }),
      qc.invalidateQueries({ queryKey: qk.bootstrap }),
    ]);
  return (
    <Card
      icon={<Library size={16} />}
      title={AGENT_TEXT.library.title}
      desc={AGENT_TEXT.library.desc}
    >
      <Stack gap={8}>
        {templates.length === 0 ? (
          <Text tone="muted" size="sm" as="p">
            {AGENT_TEXT.library.empty}
          </Text>
        ) : (
          <List density="compact" label={AGENT_TEXT.library.listLabel}>
            {templates.map((t) => (
              <ListRow
                key={t.id}
                leading={<Bot size={14} />}
                meta={
                  t.model ? (
                    <Tag title={t.model}>{t.model.replace("claude-", "").split("-")[0]}</Tag>
                  ) : undefined
                }
                actions={
                  <>
                    {projectAgentNames.includes(t.name) ? (
                      <StatusChip state="ok" dot={false} size="sm">
                        {AGENT_TEXT.library.alreadyAdded}
                      </StatusChip>
                    ) : (
                      <Button
                        variant="primary"
                        leading={<Plus size={11} />}
                        disabled={!project}
                        onClick={() =>
                          project &&
                          agentsApi
                            .instantiateAgentTemplate(t.id, project.id)
                            .then(refresh)
                            .catch((e: Error) => setError(e.message))
                        }
                      >
                        {AGENT_TEXT.library.add}
                      </Button>
                    )}
                    {/* A built-in entry has no bin at all: the API answers 409, and a greyed
                        button would explain nothing (the native `title` does not show on a
                        disabled button). The reason is written out in the row. */}
                    {!t.builtin && (
                      <IconBtn
                        title={AGENT_TEXT.library.remove}
                        danger
                        onClick={() =>
                          agentsApi
                            .deleteAgentTemplate(t.id)
                            .then(refresh)
                            .catch((e: Error) => setError(e.message))
                        }
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    )}
                  </>
                }
              >
                <Code variant="bare">{t.name}</Code>
                <Text tone="muted" size="sm">
                  {t.title}
                </Text>
                {t.builtin && (
                  <Text tone="muted" size="sm">
                    {AGENT_TEXT.library.builtin}
                  </Text>
                )}
              </ListRow>
            ))}
          </List>
        )}
        {error && <FormError>{error}</FormError>}
      </Stack>
    </Card>
  );
}
