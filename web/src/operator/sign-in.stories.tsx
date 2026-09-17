// The FIRST screen of an instance, and often the only one seen if the token is lost: it must
// stand alone, without rail, bar or anything else of the application, which is not mounted yet.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SignIn } from "./sign-in.js";

const meta = { title: "operator / Sign in (SignIn)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const never = () => new Promise<void>(() => {});

export const Empty: Story = {
  name: "at rest — the button waits until there's something to send",
  render: () => <SignIn onSignIn={async () => {}} />,
};

export const Refused: Story = {
  name: "token refused — the message comes from the server, and says nothing more",
  render: function Render() {
    const [tried, setTried] = useState(false);
    return (
      <SignIn
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
  render: () => <SignIn onSignIn={never} />,
};
