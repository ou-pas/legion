// The specimen that matters is the NETWORK. The field was missing until 25/08: the
// `environments` table existed since schema v2, but only seed scripts wrote it, so the
// Environments screen listed allowlists that no gesture could attach to an agent. The three
// states below are exactly those that decide what a session can reach.

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentSettings } from "./settings.js";
import { draftOf, type AgentDraft } from "./draft.js";
import { type Agent } from "../api/agents.js";
import { type Environment } from "../api/environments.js";
import { type RunnerSummary } from "../api/infra.js";
import { type ModelChoice } from "../api/models.js";
import { Card } from "../ui/card.js";
import { NETWORKING } from "../api/environments.js";
import { REPO_ACCESS } from "../api/agents.js";

const meta = { title: "agents / AgentSettings" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a-server",
  projectId: "p-legion",
  name: "server",
  title: "Control plane",
  model: null,
  rolePrompt: "You work on the control plane…",
  environmentId: null,
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: "[]",
  repoAccess: REPO_ACCESS.write,
  runnerPreference: null,
  inboxAccess: true,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: "[]",
  ruleIds: "[]",
  repoNames: '["legion"]',
  ...over,
});

const model = (id: string, displayName: string): ModelChoice => ({
  id,
  displayName,
  resolves: null,
  description: "",
  supportsEffort: true,
  effortLevels: ["low", "medium", "high"],
  supportsAdaptiveThinking: true,
});
const models: ModelChoice[] = [
  model("claude-opus-5", "Opus 5"),
  model("claude-sonnet-5", "Sonnet 5"),
];

/** The fleet as `GET /api/runners` returns it: one healthy machine, one asleep. The sleeping one
 *  decides whether the option carries the "asleep" suffix in the list. */
const runners: RunnerSummary[] = [
  { id: "r-mini", name: "mini-workshop", enabled: true, reachable: true },
  { id: "r-macbook", name: "laptop-workshop", enabled: true, reachable: false },
];

/** The two real environments of the Legion project, plus the one usually written by hand: a
 *  wall with a few hosts. */
const environments: Environment[] = [
  {
    id: "e-open",
    projectId: "p-legion",
    name: "open",
    networking: NETWORKING.open,
    allowedHosts: [],
  },
  {
    id: "e-limited",
    projectId: "p-legion",
    name: "limited",
    networking: NETWORKING.limited,
    allowedHosts: [
      "github.com",
      "codeload.github.com",
      "objects.githubusercontent.com",
      "registry.npmjs.org",
      "cdn.jsdelivr.net",
    ],
  },
];

/** The job sheet margin is one rail wide (`--w-aside`). Without this width a field would be
 *  validated in a full page when it will live in a column. */
function Bench({
  start,
  envs = environments,
}: {
  start?: Partial<AgentDraft>;
  envs?: Environment[];
}) {
  const a = agent();
  const [draft, setDraft] = useState<AgentDraft>({ ...draftOf(a), ...start });
  return (
    <div className="dsd-narrow">
      <Card title="Engine">
        <AgentSettings
          agent={a}
          models={models}
          environments={envs}
          runners={runners}
          defaultModel="claude-sonnet-5"
          draft={draft}
          set={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
      </Card>
    </div>
  );
}

export const NoEnvironmentTodaysDefault: Story = {
  name: "no environment — what most agents carry",
  render: function Render() {
    return <Bench />;
  },
};

export const WallWithHosts: Story = {
  name: "a wall with its hosts — the case we want to see spread",
  render: function Render() {
    return <Bench start={{ environmentId: "e-limited" }} />;
  },
};

export const OpenEnvironmentFromSeed: Story = {
  name: "an open environment, inherited from the seed — it reads as it is",
  render: function Render() {
    return <Bench start={{ environmentId: "e-open" }} />;
  },
};

export const NoEnvironmentInProject: Story = {
  name: "no environment exists yet in the project",
  render: function Render() {
    return <Bench envs={[]} />;
  },
};

export const PreferredMachineAsleepStillOffered: Story = {
  name: "a preferred machine — asleep, it stays choosable and says so",
  render: function Render() {
    return <Bench start={{ runnerPreference: "laptop-workshop" }} />;
  },
};

export const InboxAccessRemoved: Story = {
  name: "inbox access removed — the agent can no longer talk to the operator",
  render: function Render() {
    return <Bench start={{ inboxAccess: false }} />;
  },
};
