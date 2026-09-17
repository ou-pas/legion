// Notices moved from the waiting panel to the Journal (02/09), where one looks at what happened.
// Two states: the ordinary stack (with a multi-line standup), and a single entry, since the
// empty state renders NOTHING and has nothing to capture.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoticesJournalView } from "./notices-journal.js";

const meta = { title: "inbox / Log notices" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOTICES = [
  { id: "n-1", body: "Batch 03 finished, the column was removed from the schema" },
  {
    id: "n-2",
    body: "Morning standup\n- CI is green on main\n- two PRs are waiting for review",
  },
];

export const Stack: Story = {
  name: "notices, including a multi-line standup",
  render: () => <NoticesJournalView notices={NOTICES} onRead={() => {}} />,
};

export const SingleEntry: Story = {
  name: "a single notice — the cross marks it read",
  render: () => <NoticesJournalView notices={NOTICES.slice(0, 1)} onRead={() => {}} />,
};
