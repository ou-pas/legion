import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { TokenEntryForm } from "./token-entry-form.js";

const meta = { title: "operator / Token entry (TokenEntryForm)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const never = () => new Promise<void>(() => {});

export const Empty: Story = {
  name: "at rest — the button waits until there's something to send",
  render: () => <TokenEntryForm onSignIn={async () => {}} />,
};

export const Refused: Story = {
  name: "token refused — the message comes from the server, and says nothing more",
  render: function Render() {
    const [tried, setTried] = useState(false);
    return (
      <TokenEntryForm
        key={tried ? "after" : "before"}
        onSignIn={async () => {
          setTried(true);
          throw new Error("token refused");
        }}
      />
    );
  },
};

export const InProgress: Story = {
  name: "in progress — the promise never resolves, to see the wait",
  render: () => <TokenEntryForm onSignIn={never} />,
};
