// The card answers what the list does not: WHICH key is used. A project without a key consuming
// the control plane's, a project with its own, and the case nobody guesses: a valid API key
// ignored because a subscription token sleeps next to it.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActiveCredential, Secret } from "../api/projects.js";
import { qk } from "../queries.js";
import { demoProject } from "./project-fixture.js";
import { SecretsCard } from "./secrets-card.js";

const meta = { title: "projects / SecretsCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = demoProject({});

const secret = (id: string, name: string, label: string | null = null): Secret => ({
  id,
  projectId: "p1",
  name,
  label,
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

/** Seeds both keys the card reads: the secret list and the resolution VERDICT (`.active`, the
 *  same response `CredentialsCard` reads). The verdict comes from the server, not a local
 *  deduction: the fallback depends on `server/.env`, which the browser does not see. */
function withSecrets(secrets: Secret[], active: ActiveCredential | null, children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.secrets, secrets);
  if (active) qc.setQueryData(qk.projectCredentials("p1"), { credentials: [], active });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Since 07/09 the form shows its shortcut next to "Save the secret" (Enter alone no longer
 *  saves, Cmd/Ctrl+Enter does). */
export const NoSecret: Story = {
  name: "no secret — the project consumes the control plane, and the form states its shortcut",
  render: () =>
    withSecrets([], active({ from: "control-plane" }), <SecretsCard project={project} />),
};

export const NoCredential: Story = {
  name: "no credential anywhere — sessions will run mocked",
  render: () => withSecrets([], active({ from: "none" }), <SecretsCard project={project} />),
};

export const ProjectKey: Story = {
  name: "an API key of its own — the row that serves is marked",
  render: () =>
    withSecrets(
      [secret("s1", "ANTHROPIC_API_KEY", "Personal account")],
      active({ from: "project", name: "ANTHROPIC_API_KEY", label: "Personal account" }),
      <SecretsCard project={project} />,
    ),
};

export const MaskedKey: Story = {
  name: "the case that can't be guessed — an API key set, valid, masked by the subscription token",
  render: () =>
    withSecrets(
      [
        secret("s1", "CLAUDE_CODE_OAUTH_TOKEN", "Max subscription"),
        secret("s2", "ANTHROPIC_API_KEY"),
      ],
      active({ from: "project", name: "CLAUDE_CODE_OAUTH_TOKEN", label: "Max subscription" }),
      <SecretsCard project={project} />,
    ),
};

export const OrdinarySecrets: Story = {
  name: "secrets that aren't Claude credentials — no special mention",
  render: () =>
    withSecrets(
      [secret("s1", "LINEAR_API_KEY", "Acme workspace"), secret("s2", "GITHUB_TOKEN")],
      active({ from: "control-plane" }),
      <SecretsCard project={project} />,
    ),
};

export const VerdictNotLoadedYet: Story = {
  name: "the verdict hasn't come back yet — the list is complete without it",
  render: () =>
    withSecrets([secret("s1", "ANTHROPIC_API_KEY")], null, <SecretsCard project={project} />),
};

// A provider token already set here. It exists, it is used, and nothing removes it, but that
// gesture moved to Integrations, where the token is probed and sometimes refreshable. The mention
// says so without breaking anything.
export const ProviderToken: Story = {
  name: "a provider token set by hand — it stays, and the card now says where it comes from",
  render: () =>
    withSecrets(
      [secret("s1", "GITHUB_TOKEN"), secret("s2", "ANTHROPIC_API_KEY", "Personal account")],
      active({ from: "project", name: "ANTHROPIC_API_KEY", label: "Personal account" }),
      <SecretsCard project={project} />,
    ),
};
