// The gate in its only state showable in the workshop: waiting while the server is asked whether
// there is a session.
//
// The other two are deliberately absent. "Signed in" renders its child, so it shows nothing of
// the gate; "not signed in" renders `SignIn`, which has its own stories. A real `OperatorGate`
// would need a server, and a story simulating the answer would only prove the simulation.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "../ui/text.js";
import { OPERATOR_TEXT } from "./text.js";
import "./sign-in.css";

const meta = { title: "operator / Gate (OperatorGate)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Checking: Story = {
  name: "checking — a sentence rather than a blank screen",
  render: () => (
    <div className="op-signin">
      <Text tone="muted">{OPERATOR_TEXT.checking}</Text>
    </div>
  ),
};
