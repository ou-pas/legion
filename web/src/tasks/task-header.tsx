// The head of a task: its name, and the few links that do not talk about its session.
//
// Level 2: the h1 is in the top bar. Dense size: a task is an OBJECT, not a chapter, and the top bar
// already names the screen, so not the `Page` template (3xl title).
//
// Agent, state, model and cost left on 04/09 (cut C) for the verdict banner, one line instead of
// three places repeating each other. The external reference (Linear…) and the container link moved
// to the right panel on 10/09 (`task-inspector.tsx`): both are about what a session knows of the
// task, not its name. What remains is the link ELSEWHERE: the chain the task is a step of.
import { Link as RouterLink } from "@tanstack/react-router";
import { PenOff, Stamp, Workflow } from "lucide-react";
import { type Task } from "../api/tasks.js";
import { CHAIN_TEXT } from "../chains/text.js";
import { Tag } from "../ui/chip.js";
import { Row, Stack } from "../ui/flex.js";
import { Heading } from "../ui/heading.js";
import { Link } from "../ui/link.js";
import { Tooltip } from "../ui/tooltip.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";

export function TaskHeader({ task }: { task: Task }) {
  // Pulled into a constant rather than read on `task` where used: the compiler does not carry a
  // narrowing across a property access, which forced a hand-written `task.templateRunId!`.
  const chainRunId = task.templateRunId;

  return (
    <Stack gap={6} flex={1} minWidth={0}>
      <Heading level={2}>
        {task.approvalGate && <Stamp size={14} aria-label={TASK_PAGE_TEXT.header.gate} />}
        {task.readOnly && <PenOff size={14} aria-label={TASK_PAGE_TEXT.header.readOnly} />}
        {task.name}
      </Heading>
      {chainRunId !== null && (
        <Row gap={6} wrap>
          {/* Entry to the chain run (`chains/ChainRunPage.tsx`). The board has the same, on the card. */}
          <Tooltip label={CHAIN_TEXT.run.openFromTask}>
            <Link
              variant="plain"
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/chains/$runId"
                  params={{ projectId: task.projectId, runId: chainRunId }}
                  {...p}
                />
              )}
            >
              <Workflow size={12} aria-hidden="true" />
              <Tag>{CHAIN_TEXT.run.chainLabel}</Tag>
            </Link>
          </Tooltip>
        </Row>
      )}
    </Stack>
  );
}
