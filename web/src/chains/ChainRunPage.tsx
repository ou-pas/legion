// The flow view of a chain run (26/08): the board shows steps only in columns, never in chain
// order. Entry points: the step pill on a board card (`tasks/task-card.tsx`) and the task page
// header (`tasks/TaskPage.tsx`) when `task.templateRunId` is set.
import { Link as RouterLink, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { bootstrapQuery, taskQuery, tasksQuery } from "../queries.js";
import { latestSessionByTask } from "../sessions/latest-session.js";
import { Chip, Tag } from "../ui/chip.js";
import { Empty } from "../ui/empty.js";
import { Row } from "../ui/flex.js";
import { Inset } from "../ui/inset.js";
import { Link } from "../ui/link.js";
import { Page } from "../ui/page.js";
import { Prose } from "../ui/prose.js";
import { awaitedBy, chainRunSteps } from "./chain-run.js";
import { ChainRail } from "./chain-rail.js";
import { type ChainRailStep } from "./chain-rail-node.js";
import { CHAIN_TEXT } from "./text.js";

// oxlint-disable-next-line complexity -- a remote-data view: one `?? default` per list not yet arrived, then one block per chain fact (project, step count, gates, original request)
export function ChainRunPage() {
  // `strict: false`: two routes serve this page since 15/09, the short `/chains/$runId`, which
  // redirects, and the canonical `/p/$projectId/chains/$runId`, which carries the rail. A `from`
  // fixed on one would throw on the other.
  const { runId = "" } = useParams({ strict: false }) as { runId?: string };
  const { data } = useQuery(tasksQuery);
  const { data: boot } = useQuery(bootstrapQuery);
  const tasks = data?.tasks ?? [];
  const steps = chainRunSteps(tasks, runId);
  // The list (`tasksQuery`) no longer carries the brief since the 02/09 cut: the first step fetches
  // it separately. It is the only full text this view shows.
  const { data: firstDetail } = useQuery({
    ...taskQuery(steps[0]?.id ?? ""),
    enabled: steps.length > 0,
  });

  if (steps.length === 0) {
    return (
      <Page title={CHAIN_TEXT.run.fallbackTitle}>
        <Empty variant="page" title={CHAIN_TEXT.run.notFoundTitle}>
          {CHAIN_TEXT.run.notFoundWhy}
        </Empty>
      </Page>
    );
  }

  const first = steps[0]!;
  const template = boot?.templates.find((t) => t.id === first.templateId);
  const project = boot?.projects.find((p) => p.id === first.projectId);
  const sessionByTaskId = latestSessionByTask(data?.sessions ?? []);
  const agentNameById = new Map((boot?.agents ?? []).map((a) => [a.id, a.name] as const));
  const gateCount = steps.filter((s) => s.approvalGate).length;
  const railSteps: ChainRailStep[] = steps.map((task) => ({
    task,
    session: sessionByTaskId.get(task.id),
    agentName: task.assigneeAgentId ? agentNameById.get(task.assigneeAgentId) : undefined,
    awaitedBy: awaitedBy(tasks, task.id),
  }));
  const title = template?.name ?? CHAIN_TEXT.run.fallbackTitle;

  return (
    <Page
      object
      title={title}
      sub={
        <Row gap={6} wrap>
          {project && (
            <Link
              variant="plain"
              render={(p) => (
                <RouterLink to="/p/$projectId/board" params={{ projectId: project.id }} {...p} />
              )}
            >
              <Chip>{project.name}</Chip>
            </Link>
          )}
          <Tag>{CHAIN_TEXT.stepCount(steps.length)}</Tag>
          {gateCount > 0 && (
            <Tag title={CHAIN_TEXT.steps.gateWhy}>{CHAIN_TEXT.run.gateCount(gateCount)}</Tag>
          )}
        </Row>
      }
    >
      {firstDetail?.description && (
        <Inset label={CHAIN_TEXT.run.request}>
          <Prose size="sm" tone="muted" width="full">
            {firstDetail.description}
          </Prose>
        </Inset>
      )}
      <ChainRail steps={railSteps} label={CHAIN_TEXT.run.railLabel(title)} />
    </Page>
  );
}
