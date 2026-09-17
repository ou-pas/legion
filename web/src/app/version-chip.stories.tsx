// The first two states are the ABSENCE: the chip disappears when there is nothing to say, a
// behaviour a workshop shows badly unless it is set down explicitly.
//
// The third motivated the 08/09 batch. The chip turned grey when the update was blocked, and a
// grey version number in a corner reads as the installed version. It stays yellow: the colour
// says there is a gap, the tooltip says why it cannot be closed yet.
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { VersionState } from "../api/version.js";
import { Row } from "../ui/flex.js";
import { VersionChip } from "./version-chip.js";

const meta = { title: "app / VersionChip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

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

/** The chip carries a `Link`: without a mounted router the story would render an empty canvas. */
function InRouter({ children }: { children: ReactNode }) {
  const root = createRootRoute({ component: () => <Row gap={8}>{children}</Row> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return <RouterProvider router={router as never} />;
}

export const UpToDate: Story = {
  name: "up to date — nothing to show",
  render: () => (
    <InRouter>
      <VersionChip version={BASE} />
    </InRouter>
  ),
};

export const Loading: Story = {
  name: "first request — nothing either",
  render: () => (
    <InRouter>
      <VersionChip version={undefined} />
    </InRouter>
  ),
};

export const Available: Story = {
  name: "a version is available",
  render: () => (
    <InRouter>
      <VersionChip version={{ ...BASE, target: "v0.28.2", blocker: null, reason: null }} />
    </InRouter>
  ),
};

export const Blocked: Story = {
  name: "available but blocked — still yellow",
  render: () => (
    <InRouter>
      <VersionChip
        version={{
          ...BASE,
          target: "v0.28.2",
          blocker: "sessions",
          activeSessions: 2,
          reason:
            "2 session(s) are running. An update restarts the control plane and takes " +
            "their containers with it: whatever they haven't pushed yet would be lost.",
        }}
      />
    </InRouter>
  ),
};
