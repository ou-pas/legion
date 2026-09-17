// The row carries what no other surface gives: this issue ALREADY has a task. Without it the same
// task gets created twice unknowingly, the only destructive gesture of this screen, and it gives
// no warning. The other states are about the description: present, it expands; absent, the
// expand button has nothing to open.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LinearIssue } from "../api/integrations.js";
import { List } from "../ui/list.js";
import { IssueRow } from "./issue-row.js";

const meta = { title: "integrations / IssueRow" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const issue = (over: Partial<LinearIssue> = {}): LinearIssue => ({
  id: "iss-1",
  identifier: "ABC-123",
  title: 'The "Retry" button doesn\'t retry anything',
  description:
    "On the Issues screen, the \"Retry\" button of an API failure doesn't relaunch any request: the click registers, the list doesn't move.",
  url: "https://linear.app/x/issue/ABC-123",
  state: "Backlog",
  stateType: "backlog",
  project: null,
  assignee: null,
  team: null,
  ...over,
});

/** Rows live in a registry: rendering them bare would hide separators and hover. */
const row = (node: ReactNode) => <List label="Open Linear issues">{node}</List>;

const noop = () => {};

export const AtRest: Story = {
  name: "at rest — a backlog issue, not yet picked up",
  render: () =>
    row(
      <IssueRow
        issue={issue()}
        isSelected={false}
        onToggleSel={noop}
        isLinked={false}
        onCreateTask={noop}
        projectId="p1"
      />,
    ),
};

export const AlreadyLinked: Story = {
  name: "already linked to a task — this is what prevents recreating a second one",
  render: () =>
    row(
      <IssueRow
        issue={issue()}
        isSelected={false}
        onToggleSel={noop}
        isLinked="t-1"
        onCreateTask={noop}
        projectId="p1"
      />,
    ),
};

export const Checked: Story = {
  name: "checked — the gesture that prepares a grouped goal",
  render: () =>
    row(
      <IssueRow
        issue={issue()}
        isSelected
        onToggleSel={noop}
        isLinked={false}
        onCreateTask={noop}
        projectId="p1"
      />,
    ),
};

export const WithoutDescription: Story = {
  name: "no description — there's nothing to expand",
  render: () =>
    row(
      <IssueRow
        issue={issue({ description: "" })}
        isSelected={false}
        onToggleSel={noop}
        isLinked={false}
        onCreateTask={noop}
        projectId="p1"
      />,
    ),
};

export const InProgress: Story = {
  name: "in progress in Linear — the status pill follows the team's label",
  render: () =>
    row(
      <IssueRow
        issue={issue({ state: "In Progress", stateType: "started", project: "Inbox redesign" })}
        isSelected={false}
        onToggleSel={noop}
        isLinked={false}
        onCreateTask={noop}
        projectId="p1"
      />,
    ),
};

export const LongTitle: Story = {
  name: "a long title — it doesn't push the actions out of the row",
  render: () =>
    row(
      <IssueRow
        issue={issue({
          identifier: "ABC-4821",
          title:
            "Resolve the duplication between the Issues screen's creation popup and the Reviews screen's, then add stories and tests on the three pivot files",
        })}
        isSelected={false}
        onToggleSel={noop}
        isLinked={false}
        onCreateTask={noop}
        projectId="p1"
      />,
    ),
};

export const SeveralRows: Story = {
  name: 'a registry — this is where you see what "already linked" changes',
  render: () =>
    row(
      <>
        <IssueRow
          issue={issue()}
          isSelected
          onToggleSel={noop}
          isLinked={false}
          onCreateTask={noop}
          projectId="p1"
        />
        <IssueRow
          issue={issue({
            id: "iss-2",
            identifier: "ABC-124",
            title: "The baseline only fails in one direction",
          })}
          isSelected={false}
          onToggleSel={noop}
          isLinked="t-2"
          onCreateTask={noop}
          projectId="p1"
        />
        <IssueRow
          issue={issue({
            id: "iss-3",
            identifier: "ABC-125",
            title: "The API contract doesn't reread the schedules",
            state: "Todo",
            stateType: "unstarted",
          })}
          isSelected
          onToggleSel={noop}
          isLinked={false}
          onCreateTask={noop}
          projectId="p1"
        />
      </>,
    ),
};
