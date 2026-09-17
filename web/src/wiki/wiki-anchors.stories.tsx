// The wiki anchor column (direction-wiki-largeur, variant B). The app rail carries the list of
// PAGES; this column carries the SECTIONS of the page being read. Its place is always reserved: a
// page without headings leaves it empty, but the body stays exactly where it was, otherwise it
// jumps sideways when moving from a long page to a short one.
//
// The stories render the whole sheet, not the bare column: the geometry is what is checked.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { sectionsOf } from "./blocks.js";
import { WikiSheet } from "./wiki-anchors.js";
import { WikiMarkdown } from "./wiki-markdown.js";
import { Card } from "../ui/card.js";
import { BookOpen } from "lucide-react";

const meta = { title: "wiki / WikiAnchors" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LONGUE = [
  "What the product has decided, and why. The reasons matter as much as the conclusions:",
  "without them, the debate gets redone three months later without knowing what was already learned.",
  "",
  "## A single operator, on their machine",
  "",
  "The interface has no authentication and the control plane listens locally. This assumption",
  "runs through everything: secrets are decrypted server-side with a master key in",
  "the environment, the database is a SQLite file, Docker runs on the same machine.",
  "",
  "## The container dies while waiting",
  "",
  "When an agent asks a question, its session is destroyed. It was counterintuitive at first,",
  "and it became the central invariant: nothing runs, nothing costs, and the conversation",
  "resumes intact thanks to the SDK's session identifier.",
  "",
  "## The network isn't sandboxed by default",
  "",
  "An agent with no environment has no outbound restriction. This decision was made,",
  "reversed, and made again on the same day, which is worth telling.",
  "",
  "## A task can wait on several tasks",
  "",
  'Blocking between tasks is a graph, no longer a single "blocked by" field.',
].join("\n");

const COURTE = [
  "Legion is built for one person who delegates development work to agents and",
  "wants to stay in control of what they touch.",
  "",
  "It isn't a team product: there are no accounts, no roles, no cross-review. A single",
  "person assigns, arbitrates and reviews, on their machine, and everything else follows from that.",
].join("\n");

const UN_SEUL = [
  "Two intro paragraphs, then a single section. The column lists it anyway: a",
  "threshold that would hide a useful section has never served anyone.",
  "",
  "## Who it's for",
  "",
  "A single person, on their machine, who delegates and reviews.",
].join("\n");

function Feuille({ titre, contenu }: { titre: string; contenu: string }) {
  return (
    <WikiSheet sections={sectionsOf(contenu)}>
      <Card icon={<BookOpen size={16} />} title={titre}>
        <WikiMarkdown content={contenu} links={[]} />
      </Card>
    </WikiSheet>
  );
}

export const PageWithSections: Story = {
  name: "a page and its sections",
  render: () => <Feuille titre="Decisions made" contenu={LONGUE} />,
};

export const SingleSection: Story = {
  name: "a single section, listed anyway",
  render: () => <Feuille titre="Who it's for" contenu={UN_SEUL} />,
};

export const NoSection: Story = {
  name: "no section — the space stays, the text doesn't move",
  render: () => <Feuille titre="Who it's for" contenu={COURTE} />,
};

export const LongHeadings: Story = {
  name: "long titles, that wrap to a new line",
  render: () => (
    <Feuille
      titre="Decisions"
      contenu={[
        "## The network isn't sandboxed by default, and it was decided twice",
        "",
        "A section whose title is too long for the column: it wraps to a new line instead of",
        "pushing the track, whose width is a token.",
        "",
        "## A task can wait on several tasks, even outside its chain",
        "",
        "Blocking between tasks is a graph.",
        "",
        "## Short",
        "",
        "For comparison.",
      ].join("\n")}
    />
  ),
};
