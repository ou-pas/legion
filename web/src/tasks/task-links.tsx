// A task's LINEAGE on screen: where it comes from, what it left behind.
//
// It has been in the database since batch 45 (`propose_task` writes `proposedFromTaskId`), and four
// pairs slept there with no screen showing them. The operator found out by hand: "I think one of
// them created another task". This panel is the answer.
//
// What it does NOT do is a decision, not a gap: approving the parent runs nothing. The panel
// PROPOSES, recalling what the work left behind at the moment it closes, and committing stays an
// operator gesture. A child starting on its own when a parent is approved would be an unwanted
// session, launched by a click that was about something else.
//
// The component neither loads nor writes: it gets the lineage and returns a callback.
import type { ReactNode } from "react";
import { Link as RouterLink } from "@tanstack/react-router";
import { CornerDownRight, CornerUpLeft, GitBranch } from "lucide-react";
import { type TaskLink, type TaskLinks } from "../api/tasks.js";
import { Button } from "../ui/button.js";
import { Chip, StatusChip, Tag } from "../ui/chip.js";
import { Row } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { List, ListItem } from "../ui/list.js";
import { Panel, PanelHeader, PanelNote } from "../ui/panel.js";
import { Caption } from "../ui/text.js";
import { Tooltip } from "../ui/tooltip.js";
import { unmetPrerequisite } from "./prerequisite.js";
import { TASK_CHIP } from "./task-status.js";
import { TASK_TEXT } from "./text/vocabulary.js";
import { TASK_LINKS_TEXT } from "./text/task-links.js";
import "./task-links.css";
import { TASK_STATUS } from "../api/tasks.js";

/** Who carries the task or, failing that, whom the agent suggested when proposing it. Not cosmetic:
 *  it decides what the button beside it can do. */
function Bearer({ link }: { link: TaskLink }) {
  if (link.agentName) return <Tag side="left">{link.agentName}</Tag>;
  if (link.suggestedAgentName)
    return <Caption>{TASK_LINKS_TEXT.suggested(link.suggestedAgentName)}</Caption>;
  return <Caption>{TASK_LINKS_TEXT.noAgent}</Caption>;
}

function LinkRow({
  link,
  projectId,
  action,
}: {
  link: TaskLink;
  projectId: string;
  action?: ReactNode;
}) {
  return (
    <ListItem
      // The TITLE is the link, not the whole row: an anchor row cannot contain the commit button (a
      // <button> inside an <a> is invalid HTML, and the click becomes ambiguous).
      title={
        <Link
          variant="inherit"
          render={(p) => (
            <RouterLink
              to="/p/$projectId/tasks/$taskId"
              params={{ projectId, taskId: link.id }}
              {...p}
            />
          )}
        >
          {link.name}
        </Link>
      }
      meta={
        <Row gap={6}>
          {/* The dependency mark comes BEFORE the bearer: "prerequisite" changes what to do with
              the row, the agent name only describes it. */}
          {link.blocksParent && (
            <Chip size="sm" kind="st-wait" title={TASK_LINKS_TEXT.prerequisiteWhy}>
              {TASK_LINKS_TEXT.prerequisite}
            </Chip>
          )}
          <Bearer link={link} />
          <StatusChip state={TASK_CHIP[link.status]} size="sm">
            {TASK_TEXT.status[link.status]}
          </StatusChip>
        </Row>
      }
      actions={action}
    />
  );
}

export function TaskLinksPanel({
  links,
  projectId,
  busyId,
  onAdopt,
}: {
  links: TaskLinks;
  /** Lineage always stays in one project: the server copies `originTask.projectId`. */
  projectId: string;
  /** The child whose assignment is in flight: only its button spins, so two children can be
   *  committed one after the other without blocking. */
  busyId?: string | null;
  /** Assigns the suggested agent and moves the task to todo. Only called when the id exists: the
   *  component never builds an action that would fail. */
  onAdopt: (childId: string, agentId: string) => void;
}) {
  // Nothing to say, no panel: an empty "no lineage" card would be noise on ordinary tasks, the
  // majority.
  if (!links.parent && links.children.length === 0) return null;
  const sleeping = links.children.filter((c) => c.status === TASK_STATUS.later);
  // An UNMET prerequisite says more than "a task is sleeping": what was delivered here does not work.
  // It replaces the ordinary reminder instead of adding to it.
  const unmet = unmetPrerequisite(links);

  return (
    <Panel>
      <PanelHeader icon={<GitBranch size={15} />} title={TASK_LINKS_TEXT.title} />

      {/* Three possible reminders, from most to least binding, never more than one per direction.
          The tone stays `wait`: none of these tasks is broken, they wait to be picked up. */}
      {unmet && (
        <PanelNote tone="wait">
          {TASK_LINKS_TEXT.unmet(unmet.name)} {TASK_LINKS_TEXT.unmetWhy}
        </PanelNote>
      )}
      {links.parent?.blocksParent && (
        <PanelNote tone="wait">
          {TASK_LINKS_TEXT.awaited(links.parent.name)} {TASK_LINKS_TEXT.awaitedWhy}
        </PanelNote>
      )}
      {!unmet && sleeping.length > 0 && (
        <PanelNote tone="wait">
          {TASK_LINKS_TEXT.pending(sleeping.length)} {TASK_LINKS_TEXT.pendingWhy}
        </PanelNote>
      )}

      {links.parent && (
        <>
          <Caption as="p" className="dm-links-section">
            <CornerUpLeft size={11} aria-hidden="true" /> {TASK_LINKS_TEXT.parent}
          </Caption>
          <List label={TASK_LINKS_TEXT.parent}>
            <LinkRow link={links.parent} projectId={projectId} />
          </List>
        </>
      )}

      {links.children.length > 0 && (
        <>
          <Caption as="p" className="dm-links-section">
            <CornerDownRight size={11} aria-hidden="true" /> {TASK_LINKS_TEXT.children}
          </Caption>
          <List label={TASK_LINKS_TEXT.childrenLabel}>
            {links.children.map((c) => (
              <LinkRow
                key={c.id}
                link={c}
                projectId={projectId}
                action={childAction(c, projectId, busyId, onAdopt)}
              />
            ))}
          </List>
        </>
      )}
    </Panel>
  );
}

/** The action offered on a child, in only three forms.
 *
 *  · Sleeping in "Later" AND its suggested agent exists: a button commits it in one gesture.
 *  · Sleeping but the suggestion names nobody any more: NO button that would fail, the task opens
 *    instead, where an agent is chosen for good.
 *  · Already started: nothing. Its status says it. */
function childAction(
  child: TaskLink,
  projectId: string,
  busyId: string | null | undefined,
  onAdopt: (childId: string, agentId: string) => void,
): ReactNode {
  if (child.status !== TASK_STATUS.later) return undefined;
  const agentId = child.suggestedAgentId;
  if (agentId && child.suggestedAgentName) {
    return (
      <Tooltip label={TASK_LINKS_TEXT.adoptWhy(child.suggestedAgentName)}>
        <Button size="sm" loading={busyId === child.id} onClick={() => onAdopt(child.id, agentId)}>
          {TASK_LINKS_TEXT.adopt(child.suggestedAgentName)}
        </Button>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      label={
        child.suggestedAgentName
          ? TASK_LINKS_TEXT.staleWhy(child.suggestedAgentName)
          : TASK_LINKS_TEXT.pendingWhy
      }
    >
      <Link
        render={(p) => (
          <RouterLink
            to="/p/$projectId/tasks/$taskId"
            params={{ projectId, taskId: child.id }}
            {...p}
          />
        )}
      >
        {TASK_LINKS_TEXT.open}
      </Link>
    </Tooltip>
  );
}
