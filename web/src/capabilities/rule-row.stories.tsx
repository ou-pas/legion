// What these states must make visible is what the screen did not say: two rules looked
// identical, one weighing 300 bytes in every prompt and the other 27 KB.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Rule } from "../api/capabilities.js";
import { List } from "../ui/list.js";
import { RuleRow } from "./RuleRow.js";
import { RULE_STATUS } from "../api/agents.js";

const meta = { title: "capabilities / RuleRow" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const rule = (over: Partial<Rule>): Rule => ({
  id: "r1",
  projectId: "p1",
  name: "secrets-never-in-plaintext",
  content: "No secret should ever appear in plaintext in code, a commit, or an artifact.",
  allAgents: true,
  status: RULE_STATUS.active,
  createdAt: "2026-08-27T10:00:00.000Z",
  summary: "",
  repoNames: "[]",
  locked: false,
  paths: "[]",
  ...over,
});

const noop = () => {};

export const Short: Story = {
  name: "short — its body IS what goes into the prompt",
  render: () => (
    <List label="Rules">
      <RuleRow rule={rule({})} onChange={noop} onError={noop} />
    </List>
  ),
};

export const WithSummary: Story = {
  name: "long with a summary — only the summary counts",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({
          name: "eloquent-conventions",
          summary: "No Repository. One Action = one operation. Scopes live on the model.",
          content: "# Eloquent conventions\n\n".padEnd(16_000, "The detail runs for pages. "),
        })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const RepoScope: Story = {
  name: "scoped to one repo — it doesn't enter front-end sessions",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({
          name: "pest-v4-conventions",
          allAgents: true,
          repoNames: '["backend"]',
          summary: "One Pest test per behavior, never per method.",
        })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const TwoRepos: Story = {
  name: "two named repos",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({
          name: "api-naming-snake-case",
          repoNames: '["backend","acme"]',
          summary: "Every API key is named in snake_case, on both ends of the wire.",
        })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const WithPatterns: Story = {
  name: "scoped to files — it only loads on the api's .php files",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({
          name: "eloquent-conventions",
          repoNames: '["api"]',
          paths: '["repos/api/app/**/*.php","repos/api/tests/**/*.php"]',
          summary: "No Repository. One Action = one operation.",
        })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const SinglePattern: Story = {
  // "1 patterns" is the kind of mistake no logic test catches and everyone sees.
  name: "a single pattern — the count reads in the singular",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({
          name: "migrations-never-modified",
          paths: '["repos/api/database/migrations/**"]',
        })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const Heavy: Story = {
  name: "long WITHOUT a summary — this is the case to see",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({ name: "ai-module", content: "# AI module\n\n".padEnd(27_000, "Content. ") })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const Locked: Story = {
  name: "locked — no repo file can override it",
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({ name: "secrets-never-in-plaintext", locked: true })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};

export const TickedPerAgent: Story = {
  name: 'not "all agents" — it only weighs on those that carry it',
  render: () => (
    <List label="Rules">
      <RuleRow
        rule={rule({ name: "design-system-non-negotiable", allAgents: false })}
        onChange={noop}
        onError={noop}
      />
    </List>
  ),
};
