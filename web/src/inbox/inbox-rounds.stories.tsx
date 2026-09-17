// The three states show TOGETHER, which is the point: the current round in accent, a round still
// open in amber, the others neutral. In an interview with two open rounds, amber is the only
// thing saying which one to look at.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InboxRound } from "../api/inbox.js";
import { INBOX_STATUS } from "../api/inbox.js";
import { InboxRounds } from "./inbox-rounds.js";

const meta = { title: "inbox / InboxRounds" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOW = Date.UTC(2026, 8, 7, 17, 0);
const MIN = 60_000;

const round = (over: Partial<InboxRound> & { id: string }): InboxRound => ({
  body: "Round",
  status: INBOX_STATUS.answered,
  createdAt: NOW - 120 * MIN,
  answeredAt: NOW - 110 * MIN,
  fieldCount: 4,
  answeredCount: 4,
  ...over,
});

const ROUNDS = [
  round({ id: "r1", createdAt: NOW - 180 * MIN }),
  round({ id: "r2", fieldCount: 6, answeredCount: 6, createdAt: NOW - 120 * MIN }),
  round({
    id: "r3",
    status: INBOX_STATUS.open,
    answeredAt: null,
    fieldCount: 6,
    answeredCount: 2,
    createdAt: NOW - 20 * MIN,
  }),
];

/** A round's link, inert: a story mounts no router. */
const link: Parameters<typeof InboxRounds>[0]["render"] = (r, p) => <a href={`#${r.id}`} {...p} />;

export const OnAnsweredRound: Story = {
  name: "reading round 2 — the current one in accent, round 3 still open in amber",
  render: () => <InboxRounds rounds={ROUNDS} currentId="r2" render={link} />,
};

export const OnOpenRound: Story = {
  name: "answering round 3 — current wins over amber",
  render: () => <InboxRounds rounds={ROUNDS} currentId="r3" render={link} />,
};

export const SingleRound: Story = {
  name: "a single round — the bar doesn't render",
  render: () => (
    <>
      {/* A single pill pointing to the current page teaches nothing: the component renders
          `null`, and this story exists to prove it. */}
      <InboxRounds rounds={[ROUNDS[0]!]} currentId="r1" render={link} />
      <p>Nothing above this line: that's the expected behavior.</p>
    </>
  ),
};
