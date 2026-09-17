// The row of a declared repository: what the whole card cannot stage. `ReposCard` reads the
// network (four queries the workshop does not serve); the row renders from objects, the
// instance's public URL and the ongoing connection being GIVEN to it.
//
// The stale webhook and the ongoing connection are two rules that survived losing their display
// on 16/09 (the pill and button moved to the right-hand markers). Nothing held them, hence these
// stories. The `<List>` is in the story: it carries the rules and density.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Repo } from "../api/projects.js";
import { List } from "../ui/list.js";
import { RepoRow } from "./repos-section.js";

const meta = { title: "projects / RepoRow" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The instance's public URL as it is TODAY. */
const PUBLIC_URL = "https://atelier.tailnet.ts.net";

const repo = (over: Partial<Repo>): Repo => ({
  id: "r1",
  projectId: "p1",
  name: "front",
  url: "https://framagit.org/3idprint/front.git",
  forge: "gitlab",
  webhookId: null,
  webhookUrl: null,
  testCommand: null,
  createdAt: "2026-09-16T08:00:00.000Z",
  ...over,
});

const noop = () => {};

const base = {
  declared: [{ host: "framagit.org", forge: "gitlab" as const }],
  publicBaseUrl: PUBLIC_URL,
  connecting: false,
  onConnect: noop,
  onChange: noop,
  onError: noop,
};

function InList(props: Parameters<typeof RepoRow>[0]) {
  return (
    <List label="Project repos">
      <RepoRow {...props} />
    </List>
  );
}

export const WithoutCommand: Story = {
  name: "no test command — it SAYS so, it doesn't offer one more empty field",
  render: () => <InList {...base} repo={repo({})} />,
};

export const WithCommand: Story = {
  name: "with its command — the field takes the row's full width",
  render: () => (
    <InList
      {...base}
      repo={repo({
        testCommand: "yarn install --frozen-lockfile && yarn build && yarn test --run",
        webhookId: "wh_1",
        webhookUrl: `${PUBLIC_URL}/webhooks/gitlab`,
      })}
    />
  ),
};

export const WebhookToConnect: Story = {
  name: "webhook to connect — an action that costs keeps its words",
  render: () => <InList {...base} repo={repo({ name: "docker", testCommand: "make check" })} />,
};

export const StaleWebhook: Story = {
  name: 'stale webhook — the hook calls a dead address, the button says "reconnect"',
  render: () => (
    <InList
      {...base}
      repo={repo({
        testCommand: "make check",
        webhookId: "wh_1",
        // Set on the OLD public URL: the instance has moved since, the forge rings into the
        // void, and this cannot be checked without the reference.
        webhookUrl: "https://old-name.tailnet.ts.net/webhooks/gitlab",
      })}
    />
  ),
};

export const Connecting: Story = {
  name: "connecting — the button says so and doesn't fire twice",
  render: () => (
    <InList {...base} connecting repo={repo({ name: "docker", testCommand: "make check" })} />
  ),
};

export const UnguessableForge: Story = {
  name: "a host no connection names — the forge becomes a question again",
  render: () => (
    <InList
      {...base}
      declared={[]}
      repo={repo({ url: "https://git.internal.lan/3idprint/front.git" })}
    />
  ),
};
