// A Linear issue in the registry: title, state, actions, and a collapsible body with its own
// open state.
import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { Link as RouterLink } from "@tanstack/react-router";
import { type LinearIssue } from "../api/integrations.js";
import { IconBtn, Button } from "../ui/button.js";
import { StatusChip, type ChipState } from "../ui/chip.js";
import { Checkbox } from "../ui/choice.js";
import { Code } from "../ui/code.js";
import { Row } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { ListItem } from "../ui/list.js";
import { Markdownish } from "../ui/markdownish.js";
import { ISSUES_TEXT } from "./text.js";

const STATE_CHIP: Record<string, ChipState> = {
  started: "run",
  unstarted: "idle",
  backlog: "idle",
  triage: "wait",
};

export function IssueRow({
  issue,
  isSelected,
  onToggleSel,
  isLinked,
  onCreateTask,
  projectId,
}: {
  issue: LinearIssue;
  isSelected: boolean;
  onToggleSel: () => void;
  isLinked: string | false;
  onCreateTask: () => void;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDescription = issue.description.trim() !== "";

  return (
    <ListItem
      leading={
        <Checkbox checked={isSelected} onChange={onToggleSel}>
          <Code variant="bare">{issue.identifier}</Code>
        </Checkbox>
      }
      title={issue.title}
      sub={issue.project ?? undefined}
      meta={
        <StatusChip state={STATE_CHIP[issue.stateType] ?? "idle"} size="sm">
          {issue.state}
        </StatusChip>
      }
      actions={
        <>
          <Link
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            variant="plain"
            aria-label={ISSUES_TEXT.list.openInLinear(issue.identifier)}
          >
            <ExternalLink size={13} />
          </Link>
          {isLinked && (
            <Row gap={4}>
              <ArrowRight size={12} />
              <Link
                variant="plain"
                render={(p) => (
                  <RouterLink
                    to="/p/$projectId/tasks/$taskId"
                    params={{ projectId, taskId: isLinked }}
                    {...p}
                  />
                )}
              >
                {ISSUES_TEXT.list.linkedTask}
              </Link>
            </Row>
          )}
          {!isLinked && (
            <Button variant="primary" leading={<Plus size={12} />} onClick={onCreateTask}>
              {ISSUES_TEXT.list.createTask}
            </Button>
          )}
          {hasDescription && (
            <IconBtn
              title={
                open
                  ? ISSUES_TEXT.list.collapseDescription(issue.identifier)
                  : ISSUES_TEXT.list.expandDescription(issue.identifier)
              }
              onClick={() => setOpen(!open)}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </IconBtn>
          )}
        </>
      }
    >
      {open && <Markdownish text={issue.description} />}
    </ListItem>
  );
}
