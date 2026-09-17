// The empty state matters most: it is what a fresh installation shows, and an empty list
// without a sentence looks like an outage.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ConciergeConversation } from "../api/concierge.js";
import { ConversationList } from "./conversation-list.js";

const meta = { title: "concierge / ConversationList" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOW = 1_700_000_000_000;
const min = (n: number) => NOW - n * 60_000;

const CONVERSATIONS: ConciergeConversation[] = [
  {
    id: "c1",
    title: "why isn't batch 09 moving forward?",
    startedAt: min(40),
    updatedAt: min(12),
    turnCount: 4,
  },
  {
    id: "c2",
    title: "how much have I spent this week?",
    startedAt: min(200),
    updatedAt: min(180),
    turnCount: 2,
  },
  {
    id: "c3",
    title:
      "what ran tonight, and is anything still open on the review side before I get back " +
      "to the nav chantier?",
    startedAt: min(1_500),
    updatedAt: min(1_480),
    turnCount: 8,
  },
  // Opened by the brief, never followed by a question: it has no title.
  { id: "c4", title: "", startedAt: min(3_000), updatedAt: min(3_000), turnCount: 1 },
];

export const FourConversations: Story = {
  name: "four conversations — the most recently fed one first",
  render: () => <ConversationList conversations={CONVERSATIONS} now={NOW} onOpen={() => {}} />,
};

export const OneOpen: Story = {
  name: "one conversation open (real — click a row)",
  render: function Render() {
    const [selected, setSelected] = useState<string | null>("c1");
    return (
      <ConversationList
        conversations={CONVERSATIONS}
        selectedId={selected}
        now={NOW}
        onOpen={setSelected}
      />
    );
  },
};

export const None: Story = {
  name: "no conversation — we say how one will appear",
  render: () => <ConversationList conversations={[]} now={NOW} onOpen={() => {}} />,
};
