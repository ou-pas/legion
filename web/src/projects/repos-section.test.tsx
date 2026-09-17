// The Repositories card carries two facts no type defends, the two halves of one decision: merging
// two lists into one.
//
// Declared repositories come from the database, reachable ones from the network. Making the
// declared list depend on the forge's answer would be a defect: it happened, the forge answered
// 401, and the operator would no longer have seen their three repositories.
//
// Order is the only signal. There is no group heading any more (the right-hand button tells them
// apart), so only order keeps three project repositories from scattering among twelve reachable.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { projectsApi, type AvailableRepos, type Repo } from "../api/projects.js";
import { inboundWebhooksKey } from "../integrations/InboundWebhooksPanel.js";
import { qk } from "../queries.js";
import { RepoRow, ReposCard } from "./repos-section.js";
import { INBOUND_WEBHOOKS_TEXT } from "../integrations/webhooks-text.js";
import { PROJECT_PAGE_TEXT as T } from "./text/project-page.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const repo = (over: Partial<Repo> & { id: string; name: string }): Repo => ({
  projectId: "p1",
  url: `https://github.com/ou-pas/${over.name}.git`,
  forge: "github",
  webhookId: null,
  webhookUrl: null,
  testCommand: null,
  createdAt: "2026-09-16T08:00:00.000Z",
  ...over,
});

const reachable = (over: Partial<AvailableRepos> = {}): AvailableRepos => ({
  connected: ["github"],
  repos: [],
  truncated: false,
  errors: [],
  ...over,
});

function mount(declared: Repo[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.repos("p1"), declared);
  qc.setQueryData(qk.connections("p1"), { connections: [] });
  qc.setQueryData(inboundWebhooksKey, { baseUrl: "https://legion.test", webhooks: [] });
  render(
    <QueryClientProvider client={qc}>
      <ReposCard projectId="p1" />
    </QueryClientProvider>,
  );
}

/** Row order, read from the titles the list renders. */
const titles = () =>
  Array.from(document.querySelectorAll(".ui-list-title")).map((n) => n.textContent);

describe("ReposCard — a single list", () => {
  it("renders declared repositories while discovery fails", async () => {
    vi.spyOn(projectsApi, "availableRepos").mockRejectedValue(new Error("401 — token refused"));

    mount([repo({ id: "r1", name: "front" }), repo({ id: "r2", name: "api" })]);

    // The failure is said…
    expect(await screen.findByText("401 — token refused")).toBeTruthy();
    // …and the project's repositories are still there.
    expect(screen.getByText("front")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
  });

  it("puts declared before reachable, and does not offer twice what is already there", async () => {
    vi.spyOn(projectsApi, "availableRepos").mockResolvedValue(
      reachable({
        repos: [
          {
            fullName: "ou-pas/zebre",
            url: "https://github.com/ou-pas/zebre.git",
            private: false,
            forge: "github",
            declared: false,
          },
          // Already declared: its row is above, it does not reappear here.
          {
            fullName: "ou-pas/front",
            url: "https://github.com/ou-pas/front.git",
            private: false,
            forge: "github",
            declared: true,
          },
        ],
      }),
    );

    mount([repo({ id: "r1", name: "front" })]);

    await waitFor(() => expect(screen.getByText("ou-pas/zebre")).toBeTruthy());
    // `front` (declared, from the database) comes before `ou-pas/zebre` (reachable, from the network).
    expect(titles()).toEqual(["front", "ou-pas/zebre"]);
  });
});

describe("ReposCard — the empty sentence only asserts what is known", () => {
  it("says it when discovery answered and has nothing more to offer", async () => {
    vi.spyOn(projectsApi, "availableRepos").mockResolvedValue(reachable());

    mount([]);

    expect(await screen.findByText(T.repos.none)).toBeTruthy();
  });

  it("stays silent when discovery failed: nobody knows whether repositories exist", async () => {
    vi.spyOn(projectsApi, "availableRepos").mockRejectedValue(new Error("401 — token refused"));

    mount([]);

    // The error box already carries the explanation…
    expect(await screen.findByText("401 — token refused")).toBeTruthy();
    // …and "no repo" does not add a fact nothing supports.
    expect(screen.queryByText(T.repos.none)).toBeNull();
  });

  it("stays silent when the list has rows: a list with rows shows itself", async () => {
    vi.spyOn(projectsApi, "availableRepos").mockResolvedValue(
      reachable({
        repos: [
          {
            fullName: "ou-pas/zebre",
            url: "https://github.com/ou-pas/zebre.git",
            private: false,
            forge: "github",
            declared: false,
          },
        ],
      }),
    );

    mount([]);

    await waitFor(() => expect(screen.getByText("ou-pas/zebre")).toBeTruthy());
    expect(screen.queryByText(T.repos.none)).toBeNull();
  });
});

// A stale webhook is judged against a reference, not a boolean: the hook was set on a public
// address, the instance changed it since, so the forge rings into the void. "Connected" without a
// reference would be unverifiable. The rule did not change on 16/09, but where it shows did, and
// its data went from an internal query to a prop: exactly when a rule outlives its display.
describe("RepoRow — the webhook connected to a dead address", () => {
  const W = INBOUND_WEBHOOKS_TEXT.repo;
  const hooked = (webhookUrl: string) =>
    repo({ id: "r1", name: "front", webhookId: "wh_1", webhookUrl });

  const row = (r: Repo, publicBaseUrl: string | null) =>
    render(
      <RepoRow
        repo={r}
        declared={[]}
        publicBaseUrl={publicBaseUrl}
        connecting={false}
        onConnect={() => {}}
        onChange={() => {}}
        onError={() => {}}
      />,
    );

  it("says 'reconnect' when the public URL changed since connecting", () => {
    row(hooked("https://old.ts.net/webhooks/github"), "https://new.ts.net");

    expect(screen.getByText(W.stale)).toBeTruthy();
    expect(screen.getByText(W.reconnect)).toBeTruthy();
  });

  it("says 'connected' when the hook calls the current public URL", () => {
    row(hooked("https://new.ts.net/webhooks/github"), "https://new.ts.net");

    expect(screen.getByText(W.connected)).toBeTruthy();
    // Nothing to reconnect: the button is not there at all.
    expect(screen.queryByText(W.reconnect)).toBeNull();
  });

  it("judges nothing without a public URL: 'connected' without a reference is unverifiable", () => {
    row(hooked("https://old.ts.net/webhooks/github"), null);

    expect(screen.getByText(W.connected)).toBeTruthy();
    expect(screen.queryByText(W.stale)).toBeNull();
  });
});
