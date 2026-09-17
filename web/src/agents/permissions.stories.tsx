// The "Grants" card, measured at the `--w-aside` width it really lives at (`dsd-narrow`, same
// pattern as `settings.stories.tsx`). Each state covers one decision of the allowedTools batch
// (tCgO0ORtqe).

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentPermissions } from "./permissions.js";
import { draftOf, type AgentDraft } from "./draft.js";
import { type Agent } from "../api/agents.js";
import {
  type McpServer,
  type Rule,
  type SkillInfo,
  type ToolCatalog,
} from "../api/capabilities.js";
import { type Repo, type Secret } from "../api/projects.js";
import { Card } from "../ui/card.js";
import { REPO_ACCESS } from "../api/agents.js";

const meta = { title: "agents / AgentPermissions" } satisfies Meta;
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

const repos: Repo[] = [
  {
    id: "r-legion",
    projectId: "p-legion",
    name: "legion",
    url: "git@github.com:operateur/legion.git",
    forge: "github",
    webhookId: null,
    webhookUrl: null,
    testCommand: null,
    createdAt: "",
  },
];
const secrets: Secret[] = [
  { id: "s-github", projectId: "p-legion", name: "GITHUB_TOKEN", label: null },
];
const rules: Rule[] = [];
const skills: SkillInfo[] = [];
const linear: McpServer = {
  id: "m-linear",
  projectId: "p-legion",
  name: "linear",
  type: "http",
  url: "https://mcp.linear.app",
  command: null,
  allowedHosts: [],
  allAgents: false,
  createdAt: "",
};

/** The tool catalogue as `GET /api/tool-catalog` returns it. The card reads it instead of
 *  deducing it, hence a specimen here rather than a constant imported from the app. */
const catalog: ToolCatalog = {
  baseSdkTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
  legionMcpTools: [
    "mcp__legion__update_task",
    "mcp__legion__inbox_ask",
    "mcp__legion__inbox_send",
    "mcp__legion__propose_task",
    "mcp__legion__wait_for_task",
    "mcp__legion__fs_list",
    "mcp__legion__fs_read",
    "mcp__legion__fs_write",
    "mcp__legion__fs_mkdir",
    "mcp__legion__fs_delete",
  ],
  defaultTools: [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "mcp__legion__update_task",
    "mcp__legion__inbox_ask",
    "mcp__legion__inbox_send",
    "mcp__legion__propose_task",
    "mcp__legion__wait_for_task",
    "mcp__legion__fs_list",
    "mcp__legion__fs_read",
    "mcp__legion__fs_write",
    "mcp__legion__fs_mkdir",
    "mcp__legion__fs_delete",
  ],
  requiredInboxTools: ["mcp__legion__inbox_ask", "mcp__legion__inbox_send"],
  inboxGatedTools: ["mcp__legion__propose_task", "mcp__legion__wait_for_task"],
};

/** The same catalogue from a newer server that accepts both web tools (the `interviewer` agent
 *  is born with them, discussion mode spec D18). The old static mirror showed them "outside the
 *  allowlist"; here the card ticks them because it read the list. */
const catalogWithWeb: ToolCatalog = {
  ...catalog,
  baseSdkTools: [...catalog.baseSdkTools, "WebSearch", "WebFetch"],
};

/** The job sheet margin is one rail wide (`--w-aside`): a setting that does not fit there does
 *  not exist. */
function Bench({
  start,
  over = {},
  mcpServers = [],
  toolCatalog = catalog,
}: {
  start?: Partial<AgentDraft>;
  over?: Partial<Agent>;
  mcpServers?: McpServer[];
  toolCatalog?: ToolCatalog | undefined;
}) {
  const a = agent(over);
  const [draft, setDraft] = useState<AgentDraft>({ ...draftOf(a), ...start });
  return (
    <div className="dsd-narrow">
      <Card title="Grants">
        <AgentPermissions
          agent={a}
          skills={skills}
          mcpServers={mcpServers}
          rules={rules}
          repos={repos}
          secrets={secrets}
          toolCatalog={toolCatalog}
          draft={draft}
          set={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
      </Card>
    </div>
  );
}

export const DefaultSetMostAgents: Story = {
  name: "default set, agent with inbox — the case for most agents (group collapsed)",
  render: function Render() {
    return <Bench />;
  },
};

export const RestrictedOwnList: Story = {
  name: "restricted custom list — Read/Glob/Grep + both inbox tools (group expanded)",
  render: function Render() {
    return (
      <Bench
        start={{
          allowedTools: [
            "Read",
            "Glob",
            "Grep",
            "mcp__legion__inbox_ask",
            "mcp__legion__inbox_send",
          ],
        }}
      />
    );
  },
};

export const InboxAccessDisabled: Story = {
  name: "inboxAccess: false — both inbox rows become uncheckable again",
  render: function Render() {
    return <Bench over={{ inboxAccess: false }} start={{ allowedTools: ["Bash", "Read"] }} />;
  },
};

export const GrantedMcpServerAndItsTool: Story = {
  name: "an MCP server granted + its mcp__<name> checked",
  render: function Render() {
    return (
      <Bench
        mcpServers={[linear]}
        over={{ mcpServerIds: '["m-linear"]' }}
        start={{ mcpIds: ["m-linear"], allowedTools: ["Bash", "Read", "mcp__linear"] }}
      />
    );
  },
};

export const EntryOutsideCatalogue: Story = {
  name: "an entry outside the catalog (WebFetch in the database) — the catch-up row",
  render: function Render() {
    return <Bench start={{ allowedTools: ["Bash", "Read", "WebFetch"] }} />;
  },
};

export const FullCardMeasureSpecimen: Story = {
  name: "full card, all groups, a real project agent (server) — measurement specimen",
  render: function Render() {
    return (
      <Bench
        mcpServers={[linear]}
        over={{ mcpServerIds: '["m-linear"]', skillNames: "[]" }}
        start={{
          mcpIds: ["m-linear"],
          allowedTools: [
            "Bash",
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "mcp__legion__update_task",
            "mcp__legion__inbox_ask",
            "mcp__legion__inbox_send",
            "mcp__legion__fs_read",
            "mcp__linear",
          ],
        }}
      />
    );
  },
};

export const WideningCatalogue: Story = {
  name: "the server accepts two more tools (WebSearch/WebFetch) — the card checks them",
  render: function Render() {
    return (
      <Bench
        toolCatalog={catalogWithWeb}
        over={{ name: "interviewer", title: "Puts a brief to the test before it ships" }}
        start={{ allowedTools: [...catalogWithWeb.defaultTools, "WebSearch", "WebFetch"] }}
      />
    );
  },
};

export const CatalogueNotLoadedYet: Story = {
  name: "the server's catalog hasn't arrived yet — the group waits, it doesn't guess",
  render: function Render() {
    return <Bench toolCatalog={undefined} />;
  },
};
