// The wired global return banner: measuring the real render, not reading the code.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateReturnBanner } from "./update-return-banner.js";
import { resetBootVersionForTest } from "./version-boot.js";
import { versionKey } from "./version-query.js";
import type { VersionState } from "../api/version.js";

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

let responseBody: VersionState = BASE;
let calls = 0;

beforeEach(() => {
  resetBootVersionForTest(); // each test starts like a fresh page load
  responseBody = BASE;
  calls = 0;
  vi.stubGlobal("fetch", () => {
    calls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function monter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UpdateReturnBanner />
    </QueryClientProvider>,
  );
  return qc;
}

describe("the global return banner (02/09)", () => {
  it("does not show while the version has not changed since load", async () => {
    monter();
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    // Nothing to announce: `current` equals the boot version.
    expect(screen.queryByText(/has landed/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows on the first return with a version different from the one at load", async () => {
    const qc = monter();
    // Let the first response settle in the cache (not just sent: settled, otherwise the `refetch`
    // below would join the same in-flight request and see v0.5.0 again).
    await waitFor(() => expect(qc.getQueryData(versionKey)).toBeDefined());
    // ...then simulate the return after an update: a new version. The real trigger is
    // `refetchInterval` (too slow for a test); what matters is checked here, the component's
    // reaction to the next data on the same cache instance.
    responseBody = { ...BASE, current: "v0.6.0" };
    await qc.refetchQueries({ queryKey: versionKey });
    await waitFor(() => expect(screen.getByText("v0.6.0 has landed")).toBeDefined());
    expect(screen.getByRole("button", { name: /Reload/ })).toBeDefined();
  });
});
