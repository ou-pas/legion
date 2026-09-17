// The case that must stand out is `AllExhausted`: the most frequent in practice (an operator with
// two accounts will exhaust both), and the only place on screen that says so.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActiveCredential, ProjectCredentials, RankedCredential } from "../api/projects.js";
import { qk } from "../queries.js";
import { CredentialsCard } from "./credentials-card.js";
import { demoProject } from "./project-fixture.js";

const meta = { title: "projects / CredentialsCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = demoProject({});

const credential = (
  over: Partial<RankedCredential> & { id: string; rank: number },
): RankedCredential => ({
  name: "CLAUDE_CODE_OAUTH_TOKEN",
  label: null,
  exhausted: [],
  ...over,
});
const active = (over: Partial<ActiveCredential>): ActiveCredential => ({
  credentialId: null,
  from: "none",
  name: null,
  label: null,
  available: true,
  retryAt: null,
  ...over,
});

function withCredentials(data: ProjectCredentials, children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.projectCredentials("p1"), data);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export const Empty: Story = {
  name: "no account — the project consumes the control plane",
  render: () =>
    withCredentials(
      { credentials: [], active: active({ from: "control-plane" }) },
      <CredentialsCard project={project} />,
    ),
};

export const OneActiveAccount: Story = {
  name: "one account, active",
  render: () => {
    const c = credential({ id: "c1", rank: 1, label: "Personal" });
    return withCredentials(
      {
        credentials: [c],
        active: active({
          credentialId: "c1",
          from: "project",
          name: "CLAUDE_CODE_OAUTH_TOKEN",
          label: "Personal",
        }),
      },
      <CredentialsCard project={project} />,
    );
  },
};

export const FallsBackToNext: Story = {
  name: "rank 1 is exhausted — rank 2 serves, and says so",
  render: () => {
    const perso = credential({
      id: "c1",
      rank: 1,
      label: "Personal",
      exhausted: [
        { window: "five_hour", until: new Date(Date.now() + 5 * 3_600_000).toISOString() },
      ],
    });
    const pro = credential({ id: "c2", rank: 2, label: "Pro" });
    return withCredentials(
      {
        credentials: [perso, pro],
        active: active({
          credentialId: "c2",
          from: "project",
          name: "CLAUDE_CODE_OAUTH_TOKEN",
          label: "Pro",
        }),
      },
      <CredentialsCard project={project} />,
    );
  },
};

export const AllExhausted: Story = {
  name: "all accounts are exhausted — the banner says so before the list",
  render: () => {
    const retryAt = new Date(Date.now() + 90 * 60_000).toISOString();
    const perso = credential({
      id: "c1",
      rank: 1,
      label: "Personal",
      exhausted: [
        { window: "seven_day", until: new Date(Date.now() + 4 * 86_400_000).toISOString() },
      ],
    });
    const pro = credential({
      id: "c2",
      rank: 2,
      label: "Pro",
      exhausted: [{ window: "five_hour", until: retryAt }],
    });
    return withCredentials(
      {
        credentials: [perso, pro],
        active: active({
          credentialId: "c2",
          from: "project",
          name: "CLAUDE_CODE_OAUTH_TOKEN",
          label: "Pro",
          available: false,
          retryAt,
        }),
      },
      <CredentialsCard project={project} />,
    );
  },
};

export const OpusWindow: Story = {
  name: "the Opus week closes and reopens separately",
  render: () => {
    const c = credential({
      id: "c1",
      rank: 1,
      label: "Personal",
      exhausted: [
        { window: "seven_day_opus", until: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      ],
    });
    return withCredentials(
      {
        credentials: [c],
        active: active({
          credentialId: "c1",
          from: "project",
          name: "CLAUDE_CODE_OAUTH_TOKEN",
          label: "Personal",
          available: false,
          retryAt: c.exhausted[0]!.until,
        }),
      },
      <CredentialsCard project={project} />,
    );
  },
};

export const WithoutLabel: Story = {
  name: "an account never named — the variable name serves as a landmark",
  render: () => {
    const c = credential({ id: "c1", rank: 1 });
    return withCredentials(
      {
        credentials: [c],
        active: active({ credentialId: "c1", from: "project", name: "CLAUDE_CODE_OAUTH_TOKEN" }),
      },
      <CredentialsCard project={project} />,
    );
  },
};
