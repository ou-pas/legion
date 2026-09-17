// What changes between states is not the text but the ratio between what the project carries and
// the eight thousand characters it may carry. The editor must stay readable both empty and full,
// hence the reading measure, only visible with text inside.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextCard } from "./context-card.js";
import { demoProject } from "./project-fixture.js";

const meta = { title: "projects / ContextCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const WRITTEN = `## Architecture

Legion is a control plane on top of the Claude Agent SDK. The server is in Hono, the database is a
SQLite file read by Drizzle, the screen is React 19 on Vite, and live updates go through SSE.

## Vocabulary

A TASK is what's asked for; a SESSION is one execution of that task inside a container.
A task can have several sessions, a session belongs to only one task.

## What we don't do

We never push straight to main. We never regenerate a baseline to make a gate pass. We never
classify a red test as "pre-existing".`;

export const Empty: Story = {
  name: "empty — a new project, the counter at zero",
  render: () => <ContextCard project={demoProject({ context: "" })} />,
};

export const Filled: Story = {
  name: "filled — the reading measure bounds the editor",
  render: () => <ContextCard project={demoProject({ context: WRITTEN })} />,
};

export const NearTheCeiling: Story = {
  name: "near the ceiling — the counter is the only thing that warns",
  render: () => <ContextCard project={demoProject({ context: "x".repeat(7940) })} />,
};

export const SingleLine: Story = {
  name: "one line — a context started, not yet a document",
  render: () => (
    <ContextCard
      project={demoProject({ context: "pnpm monorepo: `server/` in Hono, `web/` in React 19." })}
    />
  ),
};
