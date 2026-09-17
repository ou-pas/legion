// A task's lineage: where it comes from, what it dropped, and what can be done with it.
//
// The case that matters is the THIRD: a child sleeping in "Later" with an agent only SUGGESTED.
// The real state of the backend relay task for the Environments API routes, dropped by task 08 on
// 24/08 and never seen since. The other specimens show what happens when that condition does not
// hold, because that is where the button would lie if it stayed the same.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { type TaskLink } from "../api/tasks.js";
import { TaskLinksPanel } from "./task-links.js";
import { TASK_STATUS } from "../api/tasks.js";

const meta = { title: "tasks / TaskLinksPanel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Labels come from the real board: a test set's short names hide truncation and row clutter,
 *  which are exactly what we want to see. */
const parent: TaskLink = {
  id: "LMnSc6s36g",
  name: "08 · Environments screen",
  status: TASK_STATUS.done,
  agentName: "front",
  suggestedAgentName: null,
  suggestedAgentId: null,
  blocksParent: false,
};

const sleeping: TaskLink = {
  id: "CuoCofyaaW",
  name: "Backend relay: Environments API routes",
  status: TASK_STATUS.later,
  agentName: null,
  suggestedAgentName: "backend",
  suggestedAgentId: "a-backend",
  blocksParent: false,
};

const stale: TaskLink = {
  id: "Zk3p0qRt7v",
  name: "Purge orphaned Docker images after a provisioning failure",
  status: TASK_STATUS.later,
  agentName: null,
  suggestedAgentName: "infra-bot",
  suggestedAgentId: null,
  blocksParent: false,
};

const orphan: TaskLink = {
  id: "Qw8n2mLd4x",
  name: "Document the format of a pre-review artifact",
  status: TASK_STATUS.later,
  agentName: null,
  suggestedAgentName: null,
  suggestedAgentId: null,
  blocksParent: false,
};

const running: TaskLink = {
  id: "Hb6v1cNa9s",
  name: "Backend relay: Environments API routes",
  status: TASK_STATUS.doing,
  agentName: "backend",
  suggestedAgentName: "backend",
  suggestedAgentId: "a-backend",
  blocksParent: false,
};

const finished: TaskLink = {
  id: "Tr4y7fKp2w",
  name: "Fix the breadcrumb truncation under 900px",
  status: TASK_STATUS.done,
  agentName: "front",
  suggestedAgentName: null,
  suggestedAgentId: null,
  blocksParent: false,
};

const noop = () => {};

export const SleepingChildWithSuggestedAgent: Story = {
  name: "a sleeping child, resolved suggested agent — the only case where the button commits",
  render: () => (
    <TaskLinksPanel
      links={{ parent: null, children: [sleeping] }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const SuggestionPointsToNobody: Story = {
  name: "the suggestion no longer names anyone — we open, we don't promise",
  render: () => (
    <TaskLinksPanel
      links={{ parent: null, children: [stale] }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const NoSuggestedName: Story = {
  name: "no suggested name — the deposit never named an agent",
  render: () => (
    <TaskLinksPanel
      links={{ parent: null, children: [orphan] }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const BothDirections: Story = {
  name: "both directions — where it comes from on top, what it left below",
  render: () => (
    <TaskLinksPanel
      links={{ parent, children: [sleeping, stale, finished] }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const EverythingAlreadyStarted: Story = {
  name: "everything already shipped — no reminder, nothing waiting",
  render: () => (
    <TaskLinksPanel
      links={{ parent, children: [running, finished] }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const AssignmentInFlight: Story = {
  name: "assignment in flight — only the concerned button spins",
  render: () => (
    <TaskLinksPanel
      links={{ parent: null, children: [sleeping, { ...stale, suggestedAgentId: "a-infra" }] }}
      projectId="prj-demo"
      busyId={sleeping.id}
      onAdopt={noop}
    />
  ),
};

export const PrerequisiteNotMet: Story = {
  name: "an unmet prerequisite — what's delivered here doesn't work",
  render: () => (
    <TaskLinksPanel
      links={{ parent: null, children: [{ ...sleeping, blocksParent: true }, finished] }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const SeenFromPrerequisite: Story = {
  name: "seen from the prerequisite — you're expected",
  render: () => (
    <TaskLinksPanel
      links={{
        parent: { ...parent, status: TASK_STATUS.review, blocksParent: true },
        children: [],
      }}
      projectId="prj-demo"
      onAdopt={noop}
    />
  ),
};

export const SeenFromChild: Story = {
  name: "seen from the child — the parent alone, nothing to commit",
  render: () => (
    <TaskLinksPanel links={{ parent, children: [] }} projectId="prj-demo" onAdopt={noop} />
  ),
};
