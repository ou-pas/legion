// The first state is the 07/09 outage: portable-atelier asleep through three updates, a session
// image three versions behind, and a global banner that did not name it.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { InfraRunner } from "../api/infra.js";
import { Panel } from "../ui/panel.js";
import { RunnerImageNotes } from "./runner-image-notes.js";

const meta = { title: "infra / RunnerImageNotes" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// `ProjectImageLink`'s `<RouterLink>` needs no dedicated router here: the workshop's global
// decorator (`.storybook/preview.tsx`) already mounts one.
function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <Panel>{children}</Panel>
    </QueryClientProvider>
  );
}

const BASE: InfraRunner = {
  runnerId: "r-mbp",
  runnerName: "laptop-workshop",
  dockerHost: "ssh://operateur@100.64.0.12",
  available: true,
  error: null,
  containers: [],
  networks: [],
  volumes: [],
  zombieSessions: [],
  image: {
    present: true,
    builtHash: "7cbdb2c67672",
    currentHash: "bd4579eced44",
    stale: true,
    rebuilding: false,
  },
  sharedImages: [],
  projectImages: [],
  maxConcurrentSessions: 3,
  running: 0,
  memoryMb: 4096,
  cpus: 2,
  hostMemoryMb: null,
  lastSeenAt: 1,
  metrics: {
    vm: null,
    vmReason: null,
    vmHistory: [],
    host: null,
    hostReason: null,
    hostHistory: [],
    disk: null,
    diskReason: null,
  },
};

export const SessionStale: Story = {
  name: "stale session image — the button offers to rebuild here",
  render: () => (
    <Wrap>
      <RunnerImageNotes runner={BASE} />
    </Wrap>
  ),
};

// The 09/09 outage: a task run on a machine without an image, a "No such image" at session close,
// and an Infra card stating the absence without offering the gesture.
export const SessionAbsent: Story = {
  name: "missing session image — same button as for a stale one",
  render: () => (
    <Wrap>
      <RunnerImageNotes
        runner={{
          ...BASE,
          image: {
            present: false,
            builtHash: null,
            currentHash: "bd4579eced44",
            stale: false,
            rebuilding: false,
          },
        }}
      />
    </Wrap>
  ),
};

export const SharedAbsent: Story = {
  name: "shared browser never built — the absence is stated too",
  render: () => (
    <Wrap>
      <RunnerImageNotes
        runner={{
          ...BASE,
          image: { ...BASE.image, stale: false },
          sharedImages: [
            {
              key: "browser",
              tag: "legion-browser:latest",
              makeTarget: "image-browser",
              present: false,
              builtHash: null,
              currentHash: "cafe1234",
              stale: false,
              builtVersion: null,
              currentVersion: "1.62.1",
            },
          ],
        }}
      />
    </Wrap>
  ),
};

export const Rebuilding: Story = {
  name: "rebuild in progress — the button gives way to the wait",
  render: () => (
    <Wrap>
      <RunnerImageNotes runner={{ ...BASE, image: { ...BASE.image, rebuilding: true } }} />
    </Wrap>
  ),
};

export const BrowserDrift: Story = {
  name: "shared browser that's drifted — versions named, same action",
  render: () => (
    <Wrap>
      <RunnerImageNotes
        runner={{
          ...BASE,
          image: { ...BASE.image, stale: false },
          sharedImages: [
            {
              key: "browser",
              tag: "legion-browser:latest",
              makeTarget: "image-browser",
              present: true,
              builtHash: "deadbeef",
              currentHash: "cafe1234",
              stale: true,
              builtVersion: "1.49.1",
              currentVersion: "1.62.1",
            },
          ],
        }}
      />
    </Wrap>
  ),
};

export const Everything: Story = {
  name: "session AND browser stale — one note per image",
  render: () => (
    <Wrap>
      <RunnerImageNotes
        runner={{
          ...BASE,
          sharedImages: [
            {
              key: "browser",
              tag: "legion-browser:latest",
              makeTarget: "image-browser",
              present: true,
              builtHash: "deadbeef",
              currentHash: "cafe1234",
              stale: true,
              builtVersion: "1.49.1",
              currentVersion: "1.62.1",
            },
          ],
        }}
      />
    </Wrap>
  ),
};

// The gap found alongside the "Missing image: offer the rebuild" batch (spec
// /artifacts/J5tmew3aT8): the card said "image present" (the default tag) while Kopee.me, which
// names its own, would have refused every run on this machine.
export const ProjectImageAbsent: Story = {
  name: "a project's image missing — a link to its page, not a second button",
  render: () => (
    <Wrap>
      <RunnerImageNotes
        runner={{
          ...BASE,
          image: { ...BASE.image, stale: false },
          projectImages: [
            {
              projectId: "prj-kopee",
              projectName: "Kopee.me",
              image: {
                tag: "legion-session-kopee:latest",
                dockerfile: { present: true, valid: true, error: null },
                present: false,
                builtHash: null,
                currentHash: "cafe1234",
                stale: false,
                rebuilding: false,
              },
            },
          ],
        }}
      />
    </Wrap>
  ),
};

export const ProjectImageRebuilding: Story = {
  name: "a project's image rebuilding — same sentence as the session, no button",
  render: () => (
    <Wrap>
      <RunnerImageNotes
        runner={{
          ...BASE,
          image: { ...BASE.image, stale: false },
          projectImages: [
            {
              projectId: "prj-kopee",
              projectName: "Kopee.me",
              image: {
                tag: "legion-session-kopee:latest",
                dockerfile: { present: true, valid: true, error: null },
                present: false,
                builtHash: null,
                currentHash: "cafe1234",
                stale: false,
                rebuilding: true,
              },
            },
          ],
        }}
      />
    </Wrap>
  ),
};

export const UpToDate: Story = {
  name: "all up to date — nothing to say, nothing shown",
  render: () => (
    <Wrap>
      <RunnerImageNotes runner={{ ...BASE, image: { ...BASE.image, stale: false } }} />
    </Wrap>
  ),
};
