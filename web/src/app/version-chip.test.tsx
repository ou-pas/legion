// The colour does not go out when the update is blocked (08/09). A grey chip left a neutral version
// number in a corner of the bar, read twice in one hour as the installed version. The colour says a
// gap EXISTS; the tooltip says why it cannot be closed right now.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { VersionState } from "../api/version.js";
import { VersionChip } from "./version-chip.js";

afterEach(() => cleanup());

const BASE: VersionState = {
  current: "v0.28.1",
  lastTag: "v0.28.1",
  ahead: 0,
  branch: "main",
  sha: "b78857d",
  dirty: false,
  target: null,
  commits: [],
  reachable: true,
  activeSessions: 0,
  blocker: "up-to-date",
  reason: null,
  checkError: null,
  updating: false,
  mode: "docker",
};

/** The chip holds a `Link`: without a router, rendering throws. */
function mount(version: VersionState | undefined) {
  const root = createRootRoute({ component: () => <VersionChip version={version} /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
}

const chipOf = (tag: string) => screen.getByText(tag).closest(".ui-chip");

describe("VersionChip", () => {
  it("does not exist when there is nothing to say", () => {
    mount(BASE);
    expect(screen.queryByText("v0.28.1")).toBeNull();
    cleanup();
    mount(undefined);
    expect(document.querySelector(".ui-chip")).toBeNull();
  });

  it("stays `wait` when the update is BLOCKED: that is when it most needs seeing", async () => {
    const reason = "2 sessions running.";
    mount({ ...BASE, target: "v0.28.2", blocker: "sessions", reason, activeSessions: 2 });
    await screen.findByText("v0.28.2");
    expect(chipOf("v0.28.2")?.getAttribute("data-state")).toBe("wait");
  });

  it("carries the COMING number, never the running one", async () => {
    mount({ ...BASE, target: "v0.28.2", blocker: null, reason: null });
    await screen.findByText("v0.28.2");
    expect(screen.queryByText("v0.28.1")).toBeNull();
  });
});
