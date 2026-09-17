// The states that matter are the VERDICT's, not the form's: two text fields say nothing, while
// "these commits will be attributed to nobody" is the card's only news. The verdict comes from a
// query, so each story serves it through a pre-filled client, the component's real path.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitIdentityCheck, Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { GitIdentityCard } from "./git-identity-card.js";

const meta = { title: "projects / GitIdentityCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = (over: Partial<Project>): Project => ({
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
  ...over,
});

/** A client that ALREADY answered: the story shows the final state, not a loading fade.
 *  `check: null` leaves the query pending, the "the forge has not spoken yet" state. */
function withCheck(check: GitIdentityCheck | null, p: Project) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  if (check) qc.setQueryData(qk.gitIdentityCheck(p.id), check);
  return (
    <QueryClientProvider client={qc}>
      <GitIdentityCard project={p} />
    </QueryClientProvider>
  );
}

export const Pending: Story = {
  name: "the forge hasn't responded yet — the card is complete without it",
  render: () =>
    withCheck(null, project({ gitAuthorName: "Operator", gitAuthorEmail: "operateur@acme.test" })),
};

export const Attributed: Story = {
  name: "attributed — a discreet line, not a green banner",
  render: () =>
    withCheck(
      {
        status: "attributed",
        email: "operateur@acme.test",
        login: "operator",
        suggestion: null,
        reason: null,
      },
      project({ gitAuthorName: "Operator", gitAuthorEmail: "operateur@acme.test" }),
    ),
};

export const Unattached: Story = {
  name: "the PR #573 case — valid address, unknown account, correction suggested",
  render: () =>
    withCheck(
      {
        status: "unlinked",
        email: "agents@acme.test",
        login: "operator",
        suggestion: "operateur@acme.test",
        reason:
          "\"agents@acme.test\" isn't a verified address for the operator account: commits won't be attributed to them",
      },
      project({ gitAuthorName: "Acme Agent", gitAuthorEmail: "agents@acme.test" }),
    ),
};

export const LeftAtDefault: Story = {
  name: "stayed on default — nothing to suggest, but the problem is named",
  render: () =>
    withCheck(
      {
        status: "unlinked",
        email: "legion@local",
        login: null,
        suggestion: null,
        reason:
          "the project's git identity stayed on default (legion@local): the forge won't attribute commits to anyone",
      },
      project({}),
    ),
};

export const Unverifiable: Story = {
  name: 'unverifiable — "I don\'t know" shows as-is, without crying wolf',
  render: () =>
    withCheck(
      {
        status: "unknown",
        email: "operateur@acme.test",
        login: "operator",
        suggestion: null,
        reason:
          "the forge didn't provide the account's verified addresses (token without the right to read them, or a forge that doesn't expose it) — impossible to say whether commits will be attributed",
      },
      project({ gitAuthorName: "Operator", gitAuthorEmail: "operateur@acme.test" }),
    ),
};
