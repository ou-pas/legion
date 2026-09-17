// A row of the agent registry. Pure presentation: the page wraps it in its link to
// /agents/:agentId. The capability summary leaves zeros out, but "no repo access" is said,
// because it is a decision and not a gap.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentRow } from "./agent-row.js";
import { type Agent } from "../api/agents.js";
import { Stack } from "../ui/flex.js";
import { List } from "../ui/list.js";
import { REPO_ACCESS } from "../api/agents.js";

const meta = { title: "agents / AgentRow" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Capabilities are JSON columns: the fixture writes them as the database stores them, or the
 *  row demonstrates nothing of what it really handles. */
const agent = (over: Partial<Agent>): Agent => ({
  id: "a-senior",
  projectId: "p-demo",
  name: "senior-dev",
  title: "Senior developer",
  model: "claude-sonnet-5",
  rolePrompt: "You implement tasks from the board…",
  environmentId: null,
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: '["GITHUB_TOKEN"]',
  repoAccess: REPO_ACCESS.write,
  runnerPreference: null,
  inboxAccess: true,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: '["dataviz","run","init","simplify","code-review","security-review"]',
  ruleIds: '["r-design","r-verif"]',
  repoNames: '["legion"]',
  ...over,
});

export const NormalProjectModelNoInbox: Story = {
  name: "normal · project model + no inbox · in session",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <List>
            <AgentRow agent={agent({})} />
            <AgentRow
              agent={agent({
                id: "a-spec",
                name: "spec",
                title: "Spec writer",
                model: null,
                inboxAccess: false,
                repoAccess: REPO_ACCESS.read,
                skillNames: "[]",
                ruleIds: '["r-design"]',
                envSecretNames: "[]",
              })}
            />
            <AgentRow
              live
              agent={agent({
                id: "a-review",
                name: "review-coordinator",
                title: "Review coordinator",
                model: "claude-opus-5",
                mcpServerIds: '["linear"]',
                skillNames: '["code-review"]',
              })}
            />
          </List>
        </div>
      </Stack>
    );
  },
};

export const NoGrantsLongNameAndTitle: Story = {
  name: "no grants · name and title too long",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <List>
            <AgentRow
              agent={agent({
                id: "a-nu",
                name: "scribe",
                title: "Note taker",
                model: null,
                repoAccess: REPO_ACCESS.none,
                repoNames: "[]",
                skillNames: "[]",
                ruleIds: "[]",
                envSecretNames: "[]",
              })}
            />
            <AgentRow
              live
              agent={agent({
                id: "a-long",
                name: "migration-postgres-17-coordinator",
                title: "Coordinator for the Postgres 17 migration and billing index rebuild",
                inboxAccess: false,
              })}
            />
          </List>
        </div>
      </Stack>
    );
  },
};
