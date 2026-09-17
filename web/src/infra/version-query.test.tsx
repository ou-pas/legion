// What the shared query promises (02/09): a pace that speeds up during an update, and a state that
// does not clear when the server goes silent mid-gesture. That is what freezes the bar and the
// banner instead of making them flicker during the outage (~60-90 s in Docker mode, while the
// container switches).
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { versionQueryOptions } from "./version-query.js";
import type { VersionState } from "../api/version.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE: VersionState = {
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
  updating: false,
  mode: "bare",
};

describe("the pace speeds up during an update, and only then", () => {
  it("thirty minutes when nothing runs", () => {
    const ms = versionQueryOptions.refetchInterval({
      state: { data: { ...BASE, updating: false } },
    });
    expect(ms).toBe(30 * 60_000);
  });

  it("three seconds while `updating` is true", () => {
    const ms = versionQueryOptions.refetchInterval({
      state: { data: { ...BASE, updating: true } },
    });
    expect(ms).toBe(3_000);
  });

  it("thirty minutes before the first response (no data yet)", () => {
    const ms = versionQueryOptions.refetchInterval({ state: { data: undefined } });
    expect(ms).toBe(30 * 60_000);
  });
});

/** A minimal component showing `updating` and `blocker`: just enough to observe `data` without
 *  rebuilding a whole screen. */
function Probe() {
  const { data } = useQuery(versionQueryOptions);
  return <span data-testid="probe">{data ? `${data.updating}/${data.blocker}` : "…"}</span>;
}

function withClient(children: ReactNode, qc: QueryClient) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("the 'updating + silent server' case: the last known state does not move", () => {
  it("a fetch failing during an update keeps `updating: true` shown", async () => {
    let call = 0;
    vi.stubGlobal("fetch", () => {
      call += 1;
      if (call === 1) {
        // First call: the server answers, an update is in progress.
        const body: VersionState = { ...BASE, updating: true };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      }
      // Second call: the expected outage (Docker mode switching container, or bare mode
      // restarting). `retry: false`: a single failure, not a burst.
      return Promise.reject(new Error("network unreachable"));
    });

    const qc = new QueryClient();
    render(withClient(<Probe />, qc));

    // The first fetch succeeds: `updating: true` shows.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("true/up-to-date"));

    // The second fetch (the next interval tick) fails.
    await qc.refetchQueries({ queryKey: versionQueryOptions.queryKey }).catch(() => {});

    // The text did not move: previous data stays shown, the bar does not flicker.
    expect(screen.getByTestId("probe").textContent).toBe("true/up-to-date");
    // And the failure did happen once: proof it did not stay stuck on the first call by accident.
    expect(call).toBe(2);
  });
});
