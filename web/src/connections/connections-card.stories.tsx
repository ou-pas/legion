// What a reader does not guess: the list before any gesture, a pasted token whose permissions
// are known (or not), a provider whose app is not declared (button off, paste still live),
// and a server declaring no provider at all, an empty screen that is not an outage.
//
// The open flow (the code to type) cannot be seeded from here: it lives in component state and
// only comes from a click. `ui/connect-tile.stories.tsx` carries that state.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PROVIDER, TOKEN_ORIGIN, type Connection } from "../api/connections.js";
import { demoProject } from "../projects/project-fixture.js";
import { qk } from "../queries.js";
import { ConnectionsCard } from "./connections-card.js";

const meta = { title: "connections / ConnectionsCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = demoProject({});

const connection = (
  provider: Connection["provider"],
  secretName: string,
  over: Partial<Connection> = {},
): Connection => ({
  provider,
  secretName,
  connected: false,
  renewable: false,
  origin: null,
  scopes: null,
  account: null,
  connectedAt: null,
  unconfigured: null,
  revokeUrl: "https://example.test/settings/applications",
  field: null,
  ...over,
});

/** The field GitLab requires: the instance the token belongs to. It is the only provider asking
 *  for one, and the tile pre-fills it. */
const INSTANCE_FIELD = {
  label: "GitLab instance URL",
  suggestion: "https://gitlab.com",
} satisfies Connection["field"];

/** A fixed date, not `Date.now()`: a story that changes from one day to the next compares to
 *  nothing. */
const CONNECTED_AT = Date.UTC(2026, 8, 15, 10, 0, 0);

const GRANTED = {
  connected: true,
  origin: TOKEN_ORIGIN.granted,
  scopes: ["repo", "read:org", "user:email"],
  account: "octocat",
  connectedAt: CONNECTED_AT,
} satisfies Partial<Connection>;

/** Seeds the only key the card reads: the list from `GET /api/connections`. `queryFn` never
 *  settles, a story talks to no server. */
function withConnections(connections: Connection[], children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.connections(project.id), { connections });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Freezes `fetch` before the card mounts, and returns its own restore.
 *
 *  The card passes its own `queryFn` to `useQuery`, and an explicit `queryFn` always wins over
 *  the one `defaultOptions` sets for the other stories. That was the bug of the not-loaded-yet
 *  story: a real `fetch` failed at once (no server here) and rendered the error state,
 *  indistinguishable from loading.
 *
 *  A CSF3 `beforeEach`, not a render hook (reviewed 15/09): the first version froze `fetch` in a
 *  `useState` initialiser during render. Under `<StrictMode>` the second pass would store the
 *  mock as the "original" and make the freeze permanent, and a card throwing during render
 *  never committed the restore effect. `beforeEach` runs before render and Storybook
 *  guarantees its cleanup on story change. */
function freezeFetch(impl: typeof fetch) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = real;
  };
}

export const NothingConnected: Story = {
  name: "nothing connected — one button per provider",
  render: () =>
    withConnections(
      [
        connection(PROVIDER.github, "GITHUB_TOKEN"),
        connection(PROVIDER.gitlab, "GITLAB_TOKEN", { field: INSTANCE_FIELD }),
      ],
      <ConnectionsCard project={project} />,
    ),
};

/** The case that cost the work: a provider whose host is not a constant. Without this field the
 *  probe went to `gitlab.com` and refused a perfectly valid framagit token, saying the provider
 *  did not recognise it.
 *
 *  The value is pre-filled, not a placeholder: it is sent as displayed, so an installation that
 *  only uses gitlab.com types nothing and nobody assumes anything silently. */
export const InstanceToAsk: Story = {
  name: "a provider that asks for its instance — the field serves both the button and pasting",
  render: () =>
    withConnections(
      [connection(PROVIDER.gitlab, "GITLAB_TOKEN", { field: INSTANCE_FIELD })],
      <ConnectionsCard project={project} />,
    ),
};

export const AllConnected: Story = {
  name: "everything connected — granted on both sides, renewable on only one",
  render: () =>
    withConnections(
      [
        // The case that revealed the confusion: granted by a flow, yet not refreshable ("Expire
        // user access tokens" is unticked on the GitHub app). The old signal called it
        // refreshable; the new one states both facts separately.
        connection(PROVIDER.github, "GITHUB_TOKEN", GRANTED),
        connection(PROVIDER.gitlab, "GITLAB_TOKEN", {
          ...GRANTED,
          renewable: true,
          scopes: ["api", "write_repository"],
          account: "mona",
        }),
      ],
      <ConnectionsCard project={project} />,
    ),
};

export const PastedToken: Story = {
  name: "a pasted token — its scopes were OBSERVED at the provider",
  render: () =>
    withConnections(
      [
        connection(PROVIDER.github, "GITHUB_TOKEN", {
          connected: true,
          origin: TOKEN_ORIGIN.pasted,
          scopes: ["repo", "user:email"],
          account: "octocat",
          connectedAt: CONNECTED_AT,
        }),
        connection(PROVIDER.gitlab, "GITLAB_TOKEN", { field: INSTANCE_FIELD }),
      ],
      <ConnectionsCard project={project} />,
    ),
};

export const PastedTokenUnknownScopes: Story = {
  name: "the case that can't be guessed — a pasted token whose scope is unknown",
  render: () =>
    withConnections(
      [
        // A fine-grained PAT: GitHub does not publish its scopes. Say so, instead of an empty
        // list that would read "this token can do nothing".
        connection(PROVIDER.github, "GITHUB_TOKEN", {
          connected: true,
          origin: TOKEN_ORIGIN.pasted,
          account: "octocat",
          connectedAt: CONNECTED_AT,
        }),
        connection(PROVIDER.gitlab, "GITLAB_TOKEN", { field: INSTANCE_FIELD }),
      ],
      <ConnectionsCard project={project} />,
    ),
};

export const UnknownOriginAndPage: Story = {
  name: "connected, but the token's origin is unknown — no revoke link can be pointed to",
  render: () =>
    withConnections(
      [
        // Unreadable `metadata`: the tile says nothing about provenance, and since GitHub revokes
        // an OAuth grant and a personal token on two different pages, neither can be linked.
        // The sentence stays; the link goes.
        connection(PROVIDER.github, "GITHUB_TOKEN", {
          connected: true,
          connectedAt: CONNECTED_AT,
          revokeUrl: null,
        }),
      ],
      <ConnectionsCard project={project} />,
    ),
};

export const NoAppDeclared: Story = {
  name: "no app declared — the button is off with its reason, pasting still works",
  render: () =>
    withConnections(
      [
        connection(PROVIDER.linear, "LINEAR_TOKEN", {
          unconfigured:
            "LEGION_LINEAR_CLIENT_ID required — redirect URL: https://legion.example.test/api/connections/callback",
        }),
      ],
      <ConnectionsCard project={project} />,
    ),
};

export const NoProvider: Story = {
  name: "no provider declared on the instance — empty, and that's not a failure",
  render: () => withConnections([], <ConnectionsCard project={project} />),
};

export const ListNotLoadedYet: Story = {
  name: "the list hasn't come back yet — the card holds up without it",
  beforeEach: () => freezeFetch(() => new Promise<Response>(() => {})),
  render: () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
    });
    return (
      <QueryClientProvider client={qc}>
        <ConnectionsCard project={project} />
      </QueryClientProvider>
    );
  },
};

export const ListError: Story = {
  name: "GET /api/connections fails — a message and a retry button",
  beforeEach: () => freezeFetch(() => Promise.reject(new Error("the server isn't responding"))),
  render: () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
    });
    return (
      <QueryClientProvider client={qc}>
        <ConnectionsCard project={project} />
      </QueryClientProvider>
    );
  },
};

export const PastedTokenWithoutAnyAccess: Story = {
  name: 'the third state — the provider responded, and its response is "no access"',
  render: () =>
    withConnections(
      [
        // A classic PAT with no scope ticked: GitHub sends an EMPTY header, which is an answer
        // and not an absence. Without its own sentence this state would read like the one next
        // to it (unknown scopes): neither shows a list.
        connection(PROVIDER.github, "GITHUB_TOKEN", {
          connected: true,
          origin: TOKEN_ORIGIN.pasted,
          scopes: [],
          account: "octocat",
        }),
      ],
      <ConnectionsCard project={project} />,
    ),
};
