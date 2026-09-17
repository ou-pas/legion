// The Claude credentials card carries two behaviours no type defends:
//
// Exhaustion wins over "active". The account resolution points at when everything is closed (the
// first to reopen) stays marked as the next winner, never as already serving: a regression here
// would suggest a session runs while it sleeps.
//
// The "all exhausted" banner is the most frequent case, and it must stand out before the list is
// read row by row.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  projectsApi,
  type ActiveCredential,
  type ProjectCredentials,
  type RankedCredential,
} from "../api/projects.js";
import { qk } from "../queries.js";
import { CredentialsCard } from "./credentials-card.js";
import { demoProject } from "./project-fixture.js";
import { CREDENTIALS_CARD_TEXT as T } from "./text/credentials.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

function mount(data: ProjectCredentials) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.projectCredentials("p1"), data);
  render(
    <QueryClientProvider client={qc}>
      <CredentialsCard project={project} />
    </QueryClientProvider>,
  );
  return qc;
}

describe("CredentialsCard — order and verdict", () => {
  it("marks the active account, and the others as waiting", () => {
    const perso = credential({ id: "c1", rank: 1, label: "Perso" });
    const pro = credential({ id: "c2", rank: 2, label: "Pro" });
    mount({
      credentials: [perso, pro],
      active: active({
        credentialId: "c1",
        from: "project",
        name: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Perso",
      }),
    });

    expect(screen.getByText(T.status.active)).toBeDefined();
    expect(screen.getByText(T.status.waiting)).toBeDefined();
  });

  it("an exhausted account says so with its window, even if it is next to serve", () => {
    const until = new Date(Date.now() + 90 * 60_000);
    const c = credential({
      id: "c1",
      rank: 1,
      label: "Perso",
      exhausted: [{ window: "five_hour", until: until.toISOString() }],
    });
    // Resolution points at this account as the first to reopen (`available: false`), but it is
    // still closed now: the row must never say "active".
    mount({
      credentials: [c],
      active: active({
        credentialId: "c1",
        from: "project",
        name: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Perso",
        available: false,
        retryAt: until.toISOString(),
      }),
    });

    expect(screen.queryByText(T.status.active)).toBeNull();
    expect(screen.getByText(new RegExp(T.window.five_hour.replace(" ", "\\s")))).toBeDefined();
  });

  it("all exhausted: the banner says so, before the list", () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    const c = credential({
      id: "c1",
      rank: 1,
      label: "Perso",
      exhausted: [{ window: "five_hour", until: retryAt }],
    });
    mount({
      credentials: [c],
      active: active({
        credentialId: "c1",
        from: "project",
        name: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Perso",
        available: false,
        retryAt,
      }),
    });

    expect(screen.getByText(/Every account of the project is exhausted/)).toBeDefined();
  });

  it("no account: the project uses the control plane", () => {
    mount({ credentials: [], active: active({ from: "control-plane" }) });

    expect(screen.getByText(T.active.fromControlPlane)).toBeDefined();
  });
});

describe("CredentialsCard — setting the rank", () => {
  it("the up arrow has no effect on rank 1, the down arrow none on the last", () => {
    const perso = credential({ id: "c1", rank: 1, label: "Perso" });
    const pro = credential({ id: "c2", rank: 2, label: "Pro" });
    mount({
      credentials: [perso, pro],
      active: active({
        credentialId: "c1",
        from: "project",
        name: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Perso",
      }),
    });

    const ups = screen.getAllByRole("button", { name: T.rankUp });
    const downs = screen.getAllByRole("button", { name: T.rankDown });
    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downs[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("moving rank 1 down posts the next rank", async () => {
    const patch = vi.spyOn(projectsApi, "patchCredential").mockResolvedValue({ ok: true });
    const perso = credential({ id: "c1", rank: 1, label: "Perso" });
    const pro = credential({ id: "c2", rank: 2, label: "Pro" });
    mount({
      credentials: [perso, pro],
      active: active({
        credentialId: "c1",
        from: "project",
        name: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Perso",
      }),
    });

    fireEvent.click(screen.getAllByRole("button", { name: T.rankDown })[0]!);

    await waitFor(() => expect(patch).toHaveBeenCalledWith("c1", { rank: 2 }));
  });
});

describe("CredentialsCard — adding an account", () => {
  it("the button stays disarmed while the token is missing", () => {
    mount({ credentials: [], active: active({ from: "none" }) });
    expect((screen.getByRole("button", { name: T.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("posts the token, and acknowledges the rank received", async () => {
    const add = vi
      .spyOn(projectsApi, "addCredential")
      .mockResolvedValue({ ok: true, id: "c9", rank: 3 });
    mount({ credentials: [], active: active({ from: "none" }) });

    fireEvent.change(screen.getByPlaceholderText(T.valuePlaceholder), {
      target: { value: "sk-ant-oat-x" },
    });
    fireEvent.click(screen.getByRole("button", { name: T.save }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith("p1", { value: "sk-ant-oat-x", label: undefined }),
    );
    expect(await screen.findByText(T.stored(3))).toBeDefined();
  });
});
