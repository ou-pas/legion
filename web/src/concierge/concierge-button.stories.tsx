import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpRight } from "lucide-react";
import { Link } from "../ui/link.js";
import { CONCIERGE_TEXT } from "./text.js";
import { ConciergeButton } from "./concierge-button.js";

const meta = { title: "concierge/Concierge button (ConciergeButton)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** No story reaches the network: `ask` is injected. */
const answer = (text: string) => () => new Promise<string>((r) => setTimeout(() => r(text), 200));

/** The footer leads to `/concierge` in the app; the workshop router lacks the app tree, so the
 *  stories pass a bare link. */
const toPage = (
  <Link href="#concierge" className="concierge-to-page">
    {CONCIERGE_TEXT.toPage}
    <ArrowUpRight size={12} aria-hidden="true" />
  </Link>
);

export const AtRest: Story = {
  name: "at rest — one more icon in the bar",
  render: () => <ConciergeButton ask={answer("")} pageLink={toPage} />,
};

export const OneAnswer: Story = {
  name: "an answer — open, ask, read",
  render: () => (
    <ConciergeButton
      pageLink={toPage}
      ask={answer(
        'Two sessions are running, both on Legion: the "double navigation" spec ' +
          "breakdown for four minutes, and batch 01 for eleven. Three tasks are " +
          "waiting in review, including a batch of seven slices to approve.\n\nNothing has failed " +
          "since last night.",
      )}
    />
  ),
};

export const ServerRefuses: Story = {
  name: "the server refuses — the message reads in the panel",
  render: () => (
    <ConciergeButton
      pageLink={toPage}
      ask={() => Promise.reject(new Error("no Claude credential configured"))}
    />
  ),
};
