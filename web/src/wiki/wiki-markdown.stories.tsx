// A `docs/wiki` page. Two things an agent note lacks: a VISIBLE heading hierarchy (doc pages are
// skimmed) and `[[wikilinks]]`, meaningful only in this domain.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import { WikiMarkdown } from "./wiki-markdown.js";

const meta = { title: "wiki / WikiMarkdown" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** A reduced wiki page: two heading levels, a list, a resolved link, a dead link. */
const WIKI_SAMPLE = [
  "## What happens at launch",
  "",
  "Legion checks first what it's certain of. See [[concepts/runner|the runner]] for the",
  "machine, and [[guides/environnements]] for what doesn't exist yet.",
  "",
  "### Certain refusals",
  "",
  "- a non-https repo URL",
  "- a write permission without a git identity",
  "",
  "> A refused task doesn't move from its column.",
].join("\n");

const WIKI_LINKS = [
  { target: "concepts/runner", label: "the runner", hasLabel: true, resolved: "concepts/runner" },
  // Dead link: the page does not exist. It stays RENDERED, dotted: it is the list of pages left to
  // write, and erasing it would remove the only one the corpus produces on its own.
  { target: "guides/environnements", label: "Environments", hasLabel: false, resolved: null },
];

export const PageWithResolvedAndDeadLinks: Story = {
  name: "page with resolved links and a dead link",
  render: () => (
    <Stack gap={10}>
      <WikiMarkdown content={WIKI_SAMPLE} links={WIKI_LINKS} />
    </Stack>
  ),
};
