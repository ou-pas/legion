// The bar's two figures describe the machine, never a project. Wiring sessions or Docker to a
// project id would make them move from one project to another while they describe the workstation,
// so the test checks the CALLS as much as the figures. (The quota window, which did follow the open
// project, was removed on 30/08: it was only readable with some credentials.)
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBarStatus } from "./top-bar.js";
import { SHELL_TEXT } from "./text/shell.js";

const appels: string[] = [];
/** Driven by the "update in progress" pill tests (02/09): mutable, because `/api/version` answers
 *  differently depending on what the bar should show. */
let versionUpdating = false;

beforeEach(() => {
  appels.length = 0;
  versionUpdating = false;
  vi.stubGlobal("fetch", (url: string) => {
    appels.push(url);
    let body: unknown;
    if (url.startsWith("/api/infra")) {
      body = { runners: [], stale: false, orphanCount: 0, blocker: null };
    } else if (url.startsWith("/api/inbox")) {
      body = [];
    } else if (url.startsWith("/api/version")) {
      body = {
        current: "v0.5.0",
        lastTag: "v0.5.0",
        ahead: 0,
        branch: "main",
        sha: "abc1234",
        dirty: false,
        target: null,
        commits: [],
        reachable: true,
        activeSessions: 0,
        blocker: "up-to-date",
        reason: null,
        checkError: null,
        updating: versionUpdating,
        mode: "bare",
      };
    } else {
      body = {
        tasks: [],
        sessions: [
          { id: "s1", status: "running" },
          { id: "s2", status: "running" },
        ],
      };
    }
    // `api/client.ts` reads the body as TEXT before parsing (a Hono 404 is plain text): a fake
    // `Response` exposing only `json()` would not go through that path.
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function monter() {
  // `retry: false`: a failure must show at once, not after three attempts.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TopBarStatus />
    </QueryClientProvider>,
  );
  // Both sessions pass the ACTIVE_STATES filter, so "2" shows once the data is there.
  await screen.findByText(/2/);
}

describe("the bar status group", () => {
  it("shows active sessions and Docker health", async () => {
    await monter();
    expect(screen.getByRole("group", { name: /Machine status/ })).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("sends no project id: these figures describe the workstation, never the project", async () => {
    await monter();
    expect(appels.length).toBeGreaterThan(0);
    expect(appels.every((u) => !u.includes("projectId"))).toBe(true);
  });
});

describe("the update-in-progress pill (02/09), the global signal in the bar", () => {
  it("absent when `updating` is false: the bar has only three indicators", async () => {
    versionUpdating = false;
    await monter();
    // Wait for `/api/version` to actually answer before concluding absence, otherwise a passing
    // test could have proven nothing (request not resolved yet).
    await waitFor(() => expect(appels.some((u) => u.startsWith("/api/version"))).toBe(true));
    expect(document.querySelector(".lucide-refresh-cw")).toBeNull();
  });

  it("present, as a `wait` pill, when `updating` is true", async () => {
    versionUpdating = true;
    await monter();
    const icon = await screen.findByText(SHELL_TEXT.topbar.updating, { selector: ".ui-sr" });
    const item = icon.closest(".topbar-status-item");
    expect(item).not.toBeNull();
    const dot = item!.querySelector(".topbar-status-indicator");
    // The same semantic pill as "waiting", `data-status="wait"`, the pulsing one (top-bar.css,
    // `@keyframes topbar-pulse-wait`).
    expect(dot?.getAttribute("data-status")).toBe("wait");
  });
});
