// A rail node: a real task of a chain run. The body is the same whether the gate is hatched or not
// (`Card` or `Hatch` provides the surface, never both: no card inside a card).
import { Link as RouterLink } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Stamp } from "lucide-react";
import { type Session } from "../api/sessions.js";
import { type TaskSummary } from "../api/tasks.js";
import { artifactsQuery } from "../queries.js";
import { CostValue } from "../sessions/cost.js";
import { GOAL_MARK } from "../tasks/task-card.js";
import { TASK_CHIP } from "../tasks/task-status.js";
import { TASK_TEXT } from "../tasks/text/vocabulary.js";
import { ArtifactChip } from "../tasks/artifact-chip.js";
import { Card } from "../ui/card.js";
import { Chip, StatusChip, Tag } from "../ui/chip.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Hatch } from "../ui/hatch.js";
import { Link } from "../ui/link.js";
import { Caption } from "../ui/text.js";
import { CHAIN_TEXT } from "./text.js";
import { TASK_STATUS } from "../api/tasks.js";

export type ChainRailStep = {
  task: TaskSummary;
  session?: Session;
  agentName?: string;
  /** Tasks currently blocked by this step, in the chain (the next step) or outside it
   *  (`propose_task({ blocking: true })`). Empty once the step is past: the field holding the block
   *  clears itself on `done` (see `chain-run.ts`). */
  awaitedBy: TaskSummary[];
};

export function ChainRailNode({ task, session, agentName, awaitedBy }: ChainRailStep) {
  const { data: artifacts = [] } = useQuery(artifactsQuery(task.id));
  const expected = JSON.parse(task.expectedArtifacts) as string[];
  // Hatching means "waiting for you, now", only when the gate is the actual current block. A gate
  // not reached yet (or already past) stays a pill: it lacks the urgency, and 9septies forbids a
  // second mechanism to say it.
  const blocking = task.approvalGate && task.status === TASK_STATUS.review;
  const body = (
    <Stack gap={6}>
      <Row gap={6} align="flex-start">
        <Ellipsis lines={2} as="div" className="dm-chain-title">
          {task.name.replace(GOAL_MARK, "")}
        </Ellipsis>
        <Spacer />
        {task.approvalGate && !blocking && (
          <StatusChip state="gate" dot={false} size="sm" title={CHAIN_TEXT.steps.gateWhy}>
            {CHAIN_TEXT.steps.gate}
          </StatusChip>
        )}
        <StatusChip state={TASK_CHIP[task.status]} size="sm">
          {TASK_TEXT.status[task.status]}
        </StatusChip>
      </Row>
      <Row gap={6} wrap>
        {agentName && <Chip size="sm">{agentName}</Chip>}
        {typeof session?.costUsd === "number" && (
          <Tag>
            <CostValue usd={session.costUsd} tone="default" />
          </Tag>
        )}
        {expected.map((name) => (
          <ArtifactChip key={name} name={name} present={artifacts.some((a) => a.name === name)} />
        ))}
      </Row>
      {awaitedBy.length > 0 && (
        <Caption tone="wait">{CHAIN_TEXT.run.awaitedBy(awaitedBy.map((t) => t.name))}</Caption>
      )}
    </Stack>
  );
  return (
    <Link
      variant="inherit"
      className="dm-chain-card"
      render={(p) => (
        <RouterLink
          to="/p/$projectId/tasks/$taskId"
          params={{ projectId: task.projectId, taskId: task.id }}
          {...p}
        />
      )}
    >
      {blocking ? (
        <Hatch tone="gate" icon={<Stamp size={14} />}>
          {body}
        </Hatch>
      ) : (
        <Card>{body}</Card>
      )}
    </Link>
  );
}
