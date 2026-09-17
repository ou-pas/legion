// What no story proves: what happens over time and under the finger.
//
// First the exit of a device flow, a regression from point H (round 2, 15/09): a `catch` that no
// longer destroys the flow on a transport incident (E) had removed the only thing that ended it on
// its own. A flow whose deadline has already passed must stop polling the provider and close.
//
// Then the second acquisition path (15/09): what pasting sends, to whom, and what the tile shows
// when the button is dead or the scopes unknown.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionsApi, FLOW_KIND, PROVIDER, TOKEN_ORIGIN } from "../api/connections.js";
import { demoProject } from "../projects/project-fixture.js";
import { qk } from "../queries.js";
import { ToastProvider } from "../ui/toast.js";
import { ConnectionsCard } from "./connections-card.js";

vi.mock("../api/connections.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/connections.js")>();
  return {
    ...actual,
    connectionsApi: {
      list: vi.fn(),
      start: vi.fn(),
      poll: vi.fn(),
      adopt: vi.fn(),
      forget: vi.fn(),
    },
  };
});

afterEach(cleanup);
// Clear the calls: otherwise "the disabled button called nobody" would read the previous test's
// click and pass or fail for the wrong reason.
afterEach(() => vi.clearAllMocks());

function harness(over: Record<string, unknown> = {}) {
  const project = demoProject({});
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.connections(project.id), {
    connections: [
      {
        provider: PROVIDER.github,
        secretName: "GITHUB_TOKEN",
        connected: false,
        renewable: false,
        origin: null,
        scopes: null,
        account: null,
        connectedAt: null,
        unconfigured: null,
        revokeUrl: "https://github.com/settings/applications",
        // GitHub needs nothing besides the token: its host is a constant. GitLab is the one that
        // asks for its instance.
        field: null,
        ...over,
      },
    ],
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConnectionsCard project={project} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { view, project };
}

describe("ConnectionsCard — device flow polling", () => {
  it("an already expired flow stops polling the provider and closes", async () => {
    vi.useFakeTimers();
    try {
      const intervalMs = 5_000;
      vi.mocked(connectionsApi.start).mockResolvedValue({
        flowId: "f1",
        // Already expired when the flow opens: the worst case, the one a server unreachable for a
        // long time would produce.
        expiresAt: Date.now() - 1_000,
        kind: FLOW_KIND.device,
        userCode: "WXYZ-1234",
        verificationUri: "https://github.com/login/device",
        intervalMs,
      });
      harness();

      fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
      await act(async () => {}); // let `start()` resolve and `setFlow` commit

      // The first scheduled tick: the deadline check must act here, before any provider call.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(intervalMs);
      });

      expect(connectionsApi.poll).not.toHaveBeenCalled();
      // The flow closed: the "Connect GitHub" button is back (it would be replaced by the code if
      // the flow were still open). `getByRole` throws if absent.
      expect(screen.getByRole("button", { name: "Connect GitHub" })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The second acquisition path, on the screen side. What is checked here is the wiring: the tile's
// gesture reaches the right provider with the right project, and the pasted value is treated as a
// secret while typing.
describe("ConnectionsCard — pasting a token", () => {
  it("sends the token to the tile's provider, from a masked field", async () => {
    vi.mocked(connectionsApi.adopt).mockResolvedValue({ connected: true });
    const { project } = harness();

    // `aria-label`, not a placeholder: it is the field's accessible name, and a password field has
    // no visible text to read.
    const field = screen.getByLabelText("Personal Access Token");
    // A token must not stay readable on screen while typing, nor end up in a screenshot.
    expect(field.getAttribute("type")).toBe("password");
    fireEvent.change(field, { target: { value: "ghp_colle" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect this token/ }));
    await act(async () => {});

    // `undefined` fourth is part of the contract: GitHub needs nothing besides the token, so
    // nothing is sent. Not a forgotten argument.
    expect(connectionsApi.adopt).toHaveBeenCalledWith(
      PROVIDER.github,
      project.id,
      "ghp_colle",
      undefined,
    );
  });

  // The field the provider asks for serves both gestures (15/09): a GitLab token belongs to one
  // instance, and the button and the paste must both talk to it. The prefilled value is sent as
  // is: an installation on gitlab.com types nothing, and nothing is assumed silently.
  it("sends the requested field with the paste and with the button", async () => {
    vi.mocked(connectionsApi.adopt).mockResolvedValue({ connected: true });
    const { project } = harness({
      field: { label: "URL de l'instance GitLab", suggestion: "https://gitlab.com" },
    });

    const instance = screen.getByLabelText("URL de l'instance GitLab");
    expect((instance as HTMLInputElement).value).toBe("https://gitlab.com");
    // In clear, not masked: an instance URL is not a secret, and masking it would suggest it is.
    expect(instance.getAttribute("type")).toBe("text");
    fireEvent.change(instance, { target: { value: "https://framagit.org" } });

    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(connectionsApi.start).toHaveBeenCalledWith(
      PROVIDER.github,
      project.id,
      "https://framagit.org",
    );

    fireEvent.change(screen.getByLabelText("Personal Access Token"), {
      target: { value: "glpat_colle" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Connect this token/ }));
    await act(async () => {});

    expect(connectionsApi.adopt).toHaveBeenCalledWith(
      PROVIDER.github,
      project.id,
      "glpat_colle",
      "https://framagit.org",
    );
  });

  // The button used to promise a gesture that did not exist: without a declared app, `start`
  // answered 400 and the operator found out after the click. It now reads before, with the
  // variable name alone on its line, ready to copy, while pasting stays open.
  it("disables the button when no app is declared, and splits what is missing", () => {
    harness({ unconfigured: "LEGION_GITHUB_CLIENT_ID requise" });

    const bouton = screen.getByRole("button", { name: "Connect GitHub" });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("LEGION_GITHUB_CLIENT_ID")).not.toBeNull();
    expect(screen.getByText("requise")).not.toBeNull();
    expect(screen.getByLabelText("Personal Access Token")).not.toBeNull();
    expect(connectionsApi.start).not.toHaveBeenCalled();
  });

  // A sentence that does not start with a variable stays whole: splitting would put "URL" in mono
  // and the rest below, which is worse than not splitting.
  it("does not split what is not a variable name", () => {
    harness({ unconfigured: "URL de l'instance GitLab requise" });

    expect(screen.getByText("URL de l'instance GitLab requise")).not.toBeNull();
  });

  // Unknown scopes: no list and no sentence (round 2). What must hold is that an empty list is
  // not shown as if it were the result of a read.
  it("shows no access when the provider published none", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.pasted, scopes: null });

    expect(screen.queryByText("Access observed")).toBeNull();
    expect(screen.queryByText(/reported no access/)).toBeNull();
  });
});

// The one fact nothing else carries: the provider answered, and its answer is "no access".
describe("ConnectionsCard — an empty list is a fact, not a gap", () => {
  it("an empty list says the provider found no access", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.pasted, scopes: [] });

    expect(screen.getByText(/reported no access/)).not.toBeNull();
  });

  it("a full list reads, and does not announce an empty one", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.pasted, scopes: ["repo"] });

    expect(screen.getByText("Access observed")).not.toBeNull();
    expect(screen.getByText("Repositories: read and write")).not.toBeNull();
    expect(screen.queryByText(/reported no access/)).toBeNull();
  });
});

// State and mode on the same line (round 2): the origin used to be a sentence explaining OAuth.
describe("ConnectionsCard — the state also says the mode", () => {
  it("a granted token reads 'Connected · OAuth'", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.granted });

    expect(screen.getByText("Connected · OAuth")).not.toBeNull();
    expect(screen.queryByText(/does not know Legion exists/)).toBeNull();
  });

  it("a pasted token reads 'Connected · token'", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.pasted });

    expect(screen.getByText("Connected · token")).not.toBeNull();
    expect(screen.queryByText(/Token pasted/)).toBeNull();
  });
});

// Disconnecting, and what the screen says about it.
//
// What matters is honesty, not wiring. Legion cannot revoke at the provider: revoking requires
// application authentication, so a `client_secret` we do not ship. Disconnecting forgets the token
// here; it stays valid there. A button suggesting otherwise would lie about a security gesture, so
// the admission and the link to the real revocation page are tested like the gesture itself.
describe("ConnectionsCard — disconnecting", () => {
  it("offers nothing to disconnect on a tile that is not connected", () => {
    harness();

    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("says Legion forgets the token, and where to revoke it for good", () => {
    harness({
      connected: true,
      origin: TOKEN_ORIGIN.pasted,
      account: "octocat",
      revokeUrl: "https://github.com/settings/tokens",
    });

    // Six words and the link (round 4): the presence of the link already says it is not revoked.
    expect(screen.getByText(/Disconnecting does not revoke/)).not.toBeNull();
    const lien = screen.getByRole("link", { name: /Revoke it at GitHub/ });
    // The screen does not pick the page: it renders the one the server derived from the origin.
    expect(lien.getAttribute("href")).toBe("https://github.com/settings/tokens");
  });

  // No link when no page can be named. The server returns `null` on unreadable `metadata`, since
  // it then knows neither whether the token is a grant nor whether it is personal, and those are
  // revoked in different places. A random link would send the operator where the token is not.
  it("shows no link when the revocation page is unknown, but keeps the sentence", () => {
    harness({ connected: true, origin: null, revokeUrl: null });

    expect(screen.queryByRole("link", { name: /Revoke it/ })).toBeNull();
    expect(screen.getByText(/Disconnecting does not revoke/)).not.toBeNull();
  });

  it("the admission is readable before arming the gesture, not only after", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.pasted });

    // No click: a truth that only arrives after starting a security action arrives too late to
    // weigh on the decision to start it.
    expect(screen.getByText(/Disconnecting does not revoke/)).not.toBeNull();
  });

  it("asks for confirmation, and calls the server only on the second click", async () => {
    vi.mocked(connectionsApi.forget).mockResolvedValue({ forgotten: true });
    const { project } = harness({ connected: true, origin: TOKEN_ORIGIN.granted });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(connectionsApi.forget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Forget this token/ }));
    await act(async () => {});

    expect(connectionsApi.forget).toHaveBeenCalledWith(PROVIDER.github, project.id);
  });

  // The date is the current token's, and the label says so. `putSecret` replaces the row, so
  // `created_at` dates the present token, not the first connection (round 1).
  it("dates the token, not the connection, since only the former is known", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.granted, connectedAt: Date.UTC(2026, 8, 15) });

    expect(screen.getByText(/since 15 Sept? 2026/)).not.toBeNull();
    expect(screen.queryByText(/This token since/)).toBeNull();
  });

  // The announcement says what confirming does. It used to repeat the always-visible `Caption`,
  // so a screen reader heard it twice and learned nothing about the arming.
  it("announces the effect of the second click, not the sentence already shown", () => {
    harness({ connected: true, origin: TOKEN_ORIGIN.granted });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    const annonce = screen.getByRole("status");
    expect(annonce.textContent).toMatch(/Confirming removes the GitHub token/);
    expect(annonce.textContent).not.toMatch(/Disconnecting does not revoke/);
  });
});

// A connected credential whose origin is unknown: its row's `metadata` no longer parses. The tile
// says nothing about the origin, and still says the rest.
describe("ConnectionsCard — unknown origin", () => {
  it("invents no origin, and keeps what it knows otherwise", () => {
    harness({ connected: true, origin: null, scopes: null, connectedAt: Date.UTC(2026, 8, 15) });

    // The state stays plain "Connected": no origin, no mode.
    expect(screen.getByText("Connected")).not.toBeNull();
    expect(screen.queryByText(/^Connected · (OAuth|token)$/)).toBeNull();
    expect(screen.getByText(/since 15 Sept? 2026/)).not.toBeNull();
  });
});

// The order of the idle tile (round 5): the action first, what serves a minority next, what is
// missing at the bottom.
//
// A test on DOM order because nothing else holds it: `tsc` does not see it, stories prove they
// render but not in which order, and a JSX refactor moves it silently. The instance field had in
// fact moved in front of the button without anyone asking.
describe("ConnectionsCard — the order of the idle tile", () => {
  /** Where an element sits in the document, to compare two positions. */
  const rang = (el: Element) => [...document.querySelectorAll("*")].indexOf(el);

  it("the button comes before the instance field, which is collapsed", () => {
    harness({ field: { label: "URL de l'instance GitLab", suggestion: "https://gitlab.com" } });

    const bouton = screen.getByRole("button", { name: "Connect GitHub" });
    const repli = screen.getByText("Another instance?");
    expect(rang(bouton)).toBeLessThan(rang(repli));
  });

  it("what is missing goes to the bottom, under the paste field", () => {
    harness({ unconfigured: "LEGION_GITHUB_CLIENT_ID requise" });

    const champ = screen.getByLabelText("Personal Access Token");
    const manque = screen.getByText("LEGION_GITHUB_CLIENT_ID");
    expect(rang(champ)).toBeLessThan(rang(manque));
    // The guard does not move: the reason moves, not the disabling.
    expect(
      (screen.getByRole("button", { name: "Connect GitHub" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  // The token name is written once: the titled divider carries it, the field does not repeat it.
  it("the token name is written only once, on the divider", () => {
    harness();

    expect(screen.getByText("or with a Personal Access Token")).not.toBeNull();
    // The field keeps its accessible name; only the visible duplicate is gone.
    expect(screen.getByLabelText("Personal Access Token")).not.toBeNull();
    expect(screen.queryAllByText("Personal Access Token")).toHaveLength(0);
  });
});
