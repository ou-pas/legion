// The first two are the two real CALLERS, a Linear issue and a review comment: they show what the
// parameters really change (title, quoted excerpt, gate ticked or not, consequence sentence). The
// next ones are states the popup reaches on its own: no agent to offer (the create button cannot
// arm) and a server refusal written under the form.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "../api/agents.js";
import { REPO_ACCESS } from "../api/agents.js";
import type { Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Code } from "../ui/code.js";
import { QuickTaskModal } from "./quick-task-modal.js";

const meta = { title: "tasks / QuickTaskModal" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project: Project = {
  id: "p1",
  name: "Acme",
  slug: "acme",
  defaultModel: "sonnet",
  repoUrl: null,
  fsRoot: null,
  context: "",
  demo: false,
  gitAuthorName: null,
  gitAuthorEmail: null,
  defaultSkillNames: "[]",
  modelRouting: "{}",
  chainBindings: "{}",
  sessionImage: null,
  sessionDockerfile: null,
  sshKeyPath: null,
  hue: null,
};

const agent = (id: string, name: string): Agent => ({
  id,
  projectId: "p1",
  name,
  title: "Developer",
  model: null,
  rolePrompt: "",
  environmentId: null,
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: "[]",
  repoAccess: REPO_ACCESS.none,
  runnerPreference: null,
  inboxAccess: false,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: "[]",
  ruleIds: "[]",
  repoNames: "[]",
});

/** The agent list comes through `bootstrapQuery`: the workshop SEEDS that cache key rather than
 *  calling the API, like `git-identity-card.stories.tsx`. A never-resolving client keeps the story
 *  on the chosen state instead of a network error. */
function withAgents(agents: Agent[], children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, { projects: [project], agents, runners: [], templates: [] });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const TWO_AGENTS = [agent("a1", "builder"), agent("a2", "reviewer")];

export const FromAnIssue: Story = {
  name: 'from a Linear issue — gate checked, the issue will move to "In Progress"',
  render: () =>
    withAgents(
      TWO_AGENTS,
      <QuickTaskModal
        project={project}
        title="Create a task from ABC-123"
        defaultName={'ABC-123 — The "Retry" button doesn\'t retry anything'}
        defaultGate
        preview={{
          label: "ABC-123's description",
          body: "On the Issues screen, the \"Retry\" button of an API failure doesn't relaunch any request: the click registers, the list doesn't move.",
        }}
        description={"On the Issues screen…\n\nLinear issue: https://linear.app/x/issue/ABC-123"}
        externalRef={{
          provider: "linear",
          issueId: "iss-1",
          identifier: "ABC-123",
          url: "https://linear.app/x/issue/ABC-123",
        }}
        hint='On launch, the issue moves to "In Progress" in Linear. The agent will include "Closes ABC-123" in the PR body — the merge will close the issue.'
        onClose={() => {}}
      />,
    ),
};

export const FromAComment: Story = {
  name: "from a review comment — gate unchecked, the PR is already where the review happens",
  render: () =>
    withAgents(
      TWO_AGENTS,
      <QuickTaskModal
        project={project}
        title="Fix task · legion#64"
        defaultName="Fix legion#64: the steering field stays mounted during committing"
        defaultGate={false}
        preview={{
          label: "Comment from operator",
          body: "The steering field stays mounted during `committing` — the send goes out and the server responds 409.",
        }}
        description={
          "Review comment by operator on legion#64 (web/src/tasks/task-verdict.tsx):\n\n> The steering field stays mounted…"
        }
        externalRef={{
          provider: "github-comment",
          issueId: "c-9",
          identifier: "legion#64",
          url: "https://github.com/x/legion/pull/64#discussion_r1",
          branch: "feature/steering-guard",
        }}
        hint={
          <>
            The agent will work on the <Code>feature/steering-guard</Code> branch — its push will
            update the PR, without opening a new one.
          </>
        }
        onClose={() => {}}
      />,
    ),
};

export const WithoutAgent: Story = {
  name: "no agent on the project — the button can't arm",
  render: () =>
    withAgents(
      [],
      <QuickTaskModal
        project={project}
        title="Create a task from ABC-123"
        defaultName={'ABC-123 — The "Retry" button doesn\'t retry anything'}
        defaultGate
        preview={{ label: "ABC-123's description", body: "(no description)" }}
        description=""
        externalRef={{
          provider: "linear",
          issueId: "iss-1",
          identifier: "ABC-123",
          url: "https://linear.app/x/issue/ABC-123",
        }}
        hint='On launch, the issue moves to "In Progress" in Linear.'
        onClose={() => {}}
      />,
    ),
};

export const EmptyName: Story = {
  name: "empty name — the suggested name can be cleared, the button disarms",
  render: () =>
    withAgents(
      TWO_AGENTS,
      <QuickTaskModal
        project={project}
        title="Create a task from ABC-123"
        defaultName=""
        defaultGate
        preview={{ label: "ABC-123's description", body: "The button no longer responds." }}
        description=""
        externalRef={{
          provider: "linear",
          issueId: "iss-1",
          identifier: "ABC-123",
          url: "https://linear.app/x/issue/ABC-123",
        }}
        hint='On launch, the issue moves to "In Progress" in Linear.'
        onClose={() => {}}
      />,
    ),
};

export const LongExcerpt: Story = {
  name: "a long comment — the excerpt scrolls in its block, the popup doesn't stretch",
  render: () =>
    withAgents(
      TWO_AGENTS,
      <QuickTaskModal
        project={project}
        title="Fix task · legion#64"
        defaultName="Fix legion#64: the architecture baseline only fails in one direction"
        defaultGate={false}
        preview={{
          label: "Comment from operator",
          body: Array.from(
            { length: 14 },
            (_, i) =>
              `Line ${i + 1} — a review remark that takes the space it takes, and isn't summarized before being handed to the agent.`,
          ).join("\n"),
        }}
        description="…"
        externalRef={{
          provider: "github-comment",
          issueId: "c-9",
          identifier: "legion#64",
          url: "https://github.com/x/legion/pull/64#discussion_r1",
          branch: "feature/arch-baseline",
        }}
        hint={
          <>
            The agent will work on the <Code>feature/arch-baseline</Code> branch — its push will
            update the PR.
          </>
        }
        onClose={() => {}}
      />,
    ),
};
