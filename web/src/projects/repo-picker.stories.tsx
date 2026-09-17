// Reachable repositories: the states a reader does not guess, each a moment where the screen must
// SAY something rather than show a list. The empty list is the costliest to get wrong: a GitHub
// organisation restricting third-party apps vanishes from the API without an error, so "nothing
// here" never means "you have no repositories".
//
// The `<List>` is in the story, not the component: since both lists merged (16/09),
// `RepoPicker` renders CHILDREN of the list the card opens. Without it, rules and density would
// be missing.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AvailableRepos } from "../api/projects.js";
import { List } from "../ui/list.js";
import { RepoPicker, REPO_DISCOVERY_CAP } from "./repo-picker.js";

const meta = { title: "projects / RepoPicker" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const REPOS: AvailableRepos["repos"] = [
  {
    fullName: "ou-pas/legion",
    url: "https://github.com/ou-pas/legion.git",
    private: true,
    forge: "github",
    declared: false,
  },
  {
    fullName: "kopee/back/api",
    url: "https://gitlab.com/kopee/back/api.git",
    private: false,
    forge: "gitlab",
    declared: false,
  },
];

const base = {
  loading: false,
  error: null,
  projectId: "p1",
  // Two repositories declared above, the common case, which gives the picker's empty state its
  // meaning. Without them the whole list would be empty and the card would speak.
  declaredCount: 2,
  adding: null,
  onAdd: () => {},
  onRetry: () => {},
};

const answer = (over: Partial<AvailableRepos> = {}): AvailableRepos => ({
  connected: ["github"],
  repos: REPOS,
  truncated: false,
  errors: [],
  ...over,
});

/** Everything this component renders reads INSIDE the card's list, never alone. */
function InList(props: Parameters<typeof RepoPicker>[0]) {
  return (
    <List label="Project repos">
      <RepoPicker {...props} />
    </List>
  );
}

export const ListOfRepos: Story = {
  name: "the list — you check instead of typing a URL",
  render: () => <InList {...base} data={answer()} />,
};

export const NoConnection: Story = {
  name: "no connection — the only state that carries an exit",
  render: () => <InList {...base} data={answer({ connected: [], repos: [] })} />,
};

export const Loading: Story = {
  name: "the list loading — the forges are being queried",
  render: () => <InList {...base} loading data={undefined} />,
};

export const Empty: Story = {
  name: 'the empty list — "nothing here" doesn\'t mean "you have no repos"',
  render: () => <InList {...base} data={answer({ repos: [] })} />,
};

export const Truncated: Story = {
  name: "the truncated list — the ceiling is STATED, with its number",
  render: () => <InList {...base} data={answer({ truncated: true })} />,
};

export const AlreadyDeclared: Story = {
  name: "an already declared repo LEAVES here — its row is above, with its test command",
  render: () => (
    <InList {...base} data={answer({ repos: [{ ...REPOS[0]!, declared: true }, REPOS[1]!] })} />
  ),
};

export const Failure: Story = {
  name: "the failure — the cause and the remedy, never one without the other",
  render: () => <InList {...base} data={undefined} error="500 — the route didn't respond" />,
};

export const SilentForge: Story = {
  name: "a silent forge — its refusal is named NEXT TO the list, not in its place",
  render: () => (
    <InList
      {...base}
      data={answer({
        connected: ["github", "gitlab"],
        repos: [REPOS[0]!],
        errors: [
          {
            forge: "gitlab",
            error: "gitlab didn't return the repo list (token missing the required scope)",
          },
        ],
      })}
    />
  ),
};

export const Adding: Story = {
  name: "an add in progress — the row says so and doesn't fire twice",
  render: () => <InList {...base} data={answer()} adding={REPOS[0]!.url} />,
};

export const NamedCeiling: Story = {
  name: `the ceiling copied from the server (${REPO_DISCOVERY_CAP})`,
  render: () => <InList {...base} data={answer({ truncated: true, repos: [REPOS[0]!] })} />,
};
