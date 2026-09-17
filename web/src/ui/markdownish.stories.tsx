// The Markdown subset agents really write (headings, lists, inline and block code, bold, links, GFM
// tables) rendered in `Prose` rhythm, without injected HTML. Same philosophy as `Markish`: not a
// full parser, what is not recognised stays visible text. A heading becomes a bold lead line
// (Prose does not style h1-h6, on purpose).

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./flex.js";
import { Markdownish } from "./markdownish.js";

const meta = { title: "ui / Markdownish" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const MD_REPORT = `## Shipped

- **ChainLibrary.tsx** — library block, same pattern as \`AgentsPage.TemplateLibrary\`
- \`api.ts\` + 5 methods, [PR #2](https://github.com/ou-pas/legion/pull/2) ready

Verified: all 4 commands are green.

\`\`\`bash
pnpm lint && pnpm --filter @legion/web build
\`\`\``;

const MD_TABLE = `## Checks

| Command | Result |
|----------|---------:|
| \`pnpm lint\` | OK (oxlint) |
| \`pnpm test\` | OK (1922 server, 461 web) |

All commits are in place.`;

const ROLE_PROMPT = `You implement the board's tasks on the granted repos, never beyond.

- You read \`docs/DESIGN.md\` before writing a line of front-end code.
- You open one PR per task, never a direct commit to \`main\`.

A task outside your scope gets escalated to the inbox, it doesn't get worked around.`;

export const RealAgentReport: Story = {
  name: "agent report (real)",
  render: () => (
    <Stack gap={10}>
      <Markdownish text={MD_REPORT} />
    </Stack>
  ),
};

export const UnrecognisedVisibleText: Story = {
  name: "unrecognized = visible text",
  render: () => (
    <Stack gap={10}>
      <Markdownish text={"An unclosed **bold*, a ``` with no follow-up: nothing gets swallowed."} />
    </Stack>
  ),
};

export const RefusedLink: Story = {
  name: "link refused — scheme outside http, https, mailto: rendered as text, not an anchor",
  render: () => (
    <Stack gap={10}>
      <Markdownish
        text={
          "The [report](https://example.com/report) is a link; [this one](javascript:alert(1)) and [that one](data:text/html,x) stay as text, brackets included."
        }
      />
    </Stack>
  ),
};

export const GfmTable: Story = {
  name: "GFM table — checks report",
  render: () => (
    <Stack gap={10}>
      <Markdownish text={MD_TABLE} />
    </Stack>
  ),
};

export const SizeMdAgentJobSheet: Story = {
  name: "size md — an agent's job description (comfortable reading, Prose measure)",
  render: () => (
    <Stack gap={10}>
      <Markdownish text={ROLE_PROMPT} size="md" />
    </Stack>
  ),
};
