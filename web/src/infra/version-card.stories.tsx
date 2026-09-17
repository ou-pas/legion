// The last three states cannot be produced at will on a real machine, and they are where the
// screen lies most easily: a never-tagged repository and an unreachable GitHub both look like
// "up to date" if nothing is said.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { VersionCard } from "./version-card.js";
import type { VersionState } from "../api/version.js";
import { Stack } from "../ui/flex.js";

const meta = { title: "infra / VersionCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

const BASE: VersionState = {
  current: "v0.4.0",
  lastTag: "v0.4.0",
  ahead: 0,
  branch: "main",
  sha: "5f49805",
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

const COMMITS = [
  "a1b2c3d a project's encrypted crate",
  "e4f5a6b a task filed away by its session's end",
  "7c8d9e0 missing Docker is now stated on screen",
  "1122334 the runner's ceiling becomes a setting",
  "5566778 a pause that comes from the human",
  "99aabbc ⌘K opens a credential",
];

const card = (s: VersionState) => <VersionCard state={s} onUpdate={noop} onRecheck={noop} />;

export const UpToDate: Story = {
  name: "up to date",
  render: () => card(BASE),
};

export const Available: Story = {
  name: "a version exists — the button appears",
  render: () => card({ ...BASE, target: "v0.5.0", commits: COMMITS, blocker: null }),
};

export const BlockedBySessions: Story = {
  name: "blocked: sessions are running",
  render: () =>
    card({
      ...BASE,
      target: "v0.5.0",
      commits: COMMITS.slice(0, 3),
      activeSessions: 2,
      blocker: "sessions",
      reason:
        "2 session(s) are running. An update restarts the control plane and takes their containers with it: whatever they haven't pushed yet would be lost.",
    }),
};

export const BlockedByDirtyTree: Story = {
  name: "blocked: uncommitted tree",
  render: () =>
    card({
      ...BASE,
      target: "v0.5.0",
      commits: COMMITS.slice(0, 2),
      dirty: true,
      blocker: "dirty",
      reason:
        "The working tree has uncommitted changes. Moving to a tag over it would overwrite them without saying so.",
    }),
};

export const NeverTagged: Story = {
  name: "no tag — the repo's real state before make release",
  render: () => card({ ...BASE, current: null, lastTag: null, blocker: "up-to-date" }),
};

// The ordinary state of a development repository, the one batch 89 read backwards. HEAD carries
// no tag but is past one: not "no version" but "ahead". Confusing the two offered a checkout to
// v0.1.0 from a commit after it, an update going backwards.
export const AheadOfTag: Story = {
  name: 'ahead of the last tag — definitely not "→ v0.1.0"',
  render: () =>
    card({
      ...BASE,
      current: null,
      lastTag: "v0.1.0",
      ahead: 1,
      sha: "ae5ab51",
      blocker: "up-to-date",
    }),
};

// The chip says "v0.5.0 available" and the NOTE says why the button is missing. It used to say
// "Impossible" in red, a final word on a three-minute wait.
export const AheadAndBlocked: Story = {
  name: "ahead, a version exists, and a session is running",
  render: () =>
    card({
      ...BASE,
      current: null,
      lastTag: "v0.1.0",
      ahead: 3,
      sha: "ae5ab51",
      target: "v0.5.0",
      commits: COMMITS.slice(0, 2),
      activeSessions: 1,
      blocker: "sessions",
      reason:
        "1 session(s) are running. An update restarts the control plane and takes their containers with it: whatever they haven't pushed yet would be lost.",
    }),
};

export const Unreachable: Story = {
  name: "GitHub unreachable — we don't KNOW",
  render: () =>
    card({
      ...BASE,
      current: null,
      lastTag: null,
      reachable: false,
      blocker: "unknown",
      checkError: "unreachable",
      reason: "GitHub didn't respond. Retry, or check the connection.",
    }),
};

export const PrivateRepo: Story = {
  name: "private repo with no token — GitHub responds 404, not 403",
  render: () =>
    card({
      ...BASE,
      reachable: false,
      blocker: "unknown",
      checkError: "not-found",
      reason:
        'GitHub responds "repository not found". That\'s also what it responds for a PRIVATE repo with no valid token: add a GITHUB_TOKEN secret to the project that declares this repo, with read access.',
    }),
};

// Docker mode (01/09, slice 08). The server install answered
// `{sha: "", branch: null, blocker: "detached"}`: the card said "nothing to compare" on a
// perfectly healthy machine, and the button could not exist. These two states are what it must
// say instead.

export const DockerStamped: Story = {
  name: "Docker container, version stamped at build — the button exists",
  render: () =>
    card({
      ...BASE,
      mode: "docker",
      current: null,
      lastTag: "v0.4.0",
      ahead: 3,
      sha: "ae5ab51",
      target: "v0.5.0",
      commits: COMMITS.slice(0, 3),
      blocker: null,
    }),
};

export const DockerUnstamped: Story = {
  name: "Docker container built without the ARGs — honest, not silent",
  render: () =>
    card({
      ...BASE,
      mode: "docker",
      current: null,
      lastTag: null,
      ahead: 0,
      branch: null,
      sha: "",
      reachable: false,
      checkError: "no-slug",
      blocker: "unstamped",
      reason:
        'This image was built without its version: it knows neither which commit it\'s running nor from which repo. Rebuild it with "./deploy/up.sh", which stamps the sha, the tag, the branch, and the origin into the image.',
    }),
};

export const All: Story = {
  name: "the six in a row",
  render: () => (
    <Stack gap={14}>
      {card(BASE)}
      {card({ ...BASE, target: "v0.5.0", commits: COMMITS, blocker: null })}
      {card({
        ...BASE,
        target: "v0.5.0",
        activeSessions: 2,
        blocker: "sessions",
        reason: "2 session(s) are running.",
      })}
      {card({
        ...BASE,
        current: null,
        lastTag: "v0.1.0",
        ahead: 1,
        sha: "ae5ab51",
        blocker: "up-to-date",
      })}
      {card({ ...BASE, current: null, lastTag: null, blocker: "up-to-date" })}
      {card({
        ...BASE,
        current: null,
        lastTag: null,
        reachable: false,
        blocker: "unknown",
        checkError: "unreachable",
        reason: "GitHub didn't respond.",
      })}
    </Stack>
  ),
};
