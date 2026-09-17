// The Linear issues of the workspace and their filters. The module only had IssuesPage.test.tsx
// (the "later" status regression), nothing rendering the "no Linear key" empty state, the first
// state this batch fixed (the button pointed at the Library, it now points at the project's
// secrets settings).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { qk } from "../queries.js";
import { IssuesPage } from "./IssuesPage.js";

const meta = { title: "integrations / IssuesPage" } satisfies Meta;
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

/** In the workshop the project stays `null` for lack of a route (same as
 *  `ReviewsPage.stories.tsx`), so the Linear query is never enabled. `setQueryData` can only set a
 *  successful response, so for an ERROR the state is seeded directly in the cache, at the key an
 *  empty project and resting filters produce. */
function withMissingKey(message: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, { projects: [project], agents: [], runners: [], templates: [] });
  qc.setQueryData(qk.tasks, { tasks: [], sessions: [] });
  qc.getQueryCache()
    .build(qc, { queryKey: ["linear-issues", "", "", "", ""] })
    .setState({ status: "error", error: new Error(message), fetchStatus: "idle" });
  return (
    <QueryClientProvider client={qc}>
      <IssuesPage />
    </QueryClientProvider>
  );
}

export const NoLinearKey: Story = {
  name: "Linear not connected yet — an empty state with a door, not a failure",
  // The server's message word for word (`NO_LINEAR_TOKEN`, `server/src/integrations/linear.ts`):
  // `message.includes("LINEAR_TOKEN")` decides which state renders, and a paraphrase here would
  // render the generic error in a story claiming to show the empty state.
  render: () =>
    withMissingKey(
      "Linear isn't connected on this project: the LINEAR_TOKEN secret is missing. Connect Linear from Integrations.",
    ),
};
