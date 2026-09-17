// The screen has four outcomes and three are NOT errors: no GitHub key on the project (an empty
// state with a way out), no open PR, and a PR without comments. The fourth, a failing call, must
// be told apart from the other three at a glance; that is the whole point of this file.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OpenPr } from "../api/review.js";
import { qk } from "../queries.js";
import { ReviewsPage } from "./ReviewsPage.js";

const meta = { title: "review / ReviewsPage" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = {
  id: "p-1",
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

const comment = (id: string, author: string, body: string, path: string | null = null) => ({
  id,
  author,
  body,
  path,
  url: `https://github.com/x/legion/pull/64#discussion_${id}`,
  createdAt: "2026-09-06T10:00:00.000Z",
});

const PRS: OpenPr[] = [
  {
    repo: "legion",
    number: 64,
    title: "The quick create popup is written once",
    url: "https://github.com/x/legion/pull/64",
    branch: "legion/quick-task-modal",
    mergeState: "mergeable",
    comments: [
      comment(
        "c1",
        "operator",
        "The launch refusal leaves the popup open: check that the task isn't recreated on retry.",
        "web/src/tasks/quick-task-modal.tsx",
      ),
      comment("c2", "operator", "Do both catalogs still carry dead keys?"),
    ],
  },
  {
    repo: "legion",
    number: 65,
    title: "The settings cards move out of ProjectPage",
    url: "https://github.com/x/legion/pull/65",
    branch: "legion/settings-cards",
    mergeState: "conflict",
    comments: [],
  },
];

/** The screen reads the base (for the project in the URL, absent in the workshop) and the PR
 *  list. The project stays `null` for lack of a route, so the query is never enabled and the
 *  story seeds its key directly, the real project's. */
function withPrs(data: unknown, children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, { projects: [project], agents: [], runners: [], templates: [] });
  qc.setQueryData(["github-prs", ""], data);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** `setQueryData` can only set a successful response; this state needs an ERROR, and the query
 *  is never enabled in the workshop, so the query state is seeded directly in the cache. */
function withMissingToken(message: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, { projects: [project], agents: [], runners: [], templates: [] });
  qc.getQueryCache()
    .build(qc, { queryKey: ["github-prs", ""] })
    .setState({ status: "error", error: new Error(message), fetchStatus: "idle" });
  return (
    <QueryClientProvider client={qc}>
      <ReviewsPage />
    </QueryClientProvider>
  );
}

export const NoGitHubToken: Story = {
  name: "no GitHub token on the project — an empty state with a door, not a failure",
  render: () =>
    withMissingToken("GITHUB_TOKEN secret missing from the project (required for github)"),
};

export const TwoPrs: Story = {
  name: "two open PRs — one mergeable and commented, the other in conflict",
  render: () => withPrs(PRS, <ReviewsPage />),
};

export const NoPr: Story = {
  name: "no open PR — the review queue is empty, it's not a failure",
  render: () => withPrs([], <ReviewsPage />),
};

export const WithoutComments: Story = {
  name: "a PR with no comment — nothing to fix, and the screen says so",
  render: () => withPrs([{ ...PRS[0]!, comments: [] }], <ReviewsPage />),
};

export const ManyComments: Story = {
  name: "a heavily commented PR — the registry carries the whole review",
  render: () =>
    withPrs(
      [
        {
          ...PRS[0]!,
          comments: Array.from({ length: 7 }, (_, i) =>
            comment(
              `c${i}`,
              i % 2 === 0 ? "operator" : "reviewer-bot",
              `Remark number ${i + 1} — this one is about a specific line and quotes what it's asking for.`,
              i % 3 === 0 ? "server/src/tasks/routes.ts" : null,
            ),
          ),
        },
      ],
      <ReviewsPage />,
    ),
};

export const UnknownMergeState: Story = {
  name: 'the forge hasn\'t finished computing — "unknown" is NOT "mergeable"',
  render: () => withPrs([{ ...PRS[0]!, mergeState: "unknown" }], <ReviewsPage />),
};
