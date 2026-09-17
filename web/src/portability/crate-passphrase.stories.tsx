// The crate passphrase, typed twice. The two error states are the component's reason to exist:
// the server can refuse a passphrase that is too short but cannot see a typo. Mistyped twice, it
// yields a perfectly valid crate nobody can open any more.
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CratePassphrase } from "./crate-passphrase.js";
import { Card } from "../ui/card.js";

const meta = { title: "portability / CratePassphrase" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Live({ p0, r0 }: { p0: string; r0: string }) {
  const [pass, setPass] = useState(p0);
  const [repeat, setRepeat] = useState(r0);
  return (
    <Card title="Passphrase">
      <CratePassphrase pass={pass} repeat={repeat} onPass={setPass} onRepeat={setRepeat} />
    </Card>
  );
}

export const Empty: Story = {
  name: "empty",
  render: function Render() {
    return <Live p0="" r0="" />;
  },
};

export const TooShort: Story = {
  name: "too short — the count is stated",
  render: function Render() {
    return <Live p0="short" r0="" />;
  },
};

export const Mismatch: Story = {
  name: "the two entries differ",
  render: function Render() {
    return <Live p0="a whole passphrase that fits" r0="a whole passphrase that fit" />;
  },
};

export const Ready: Story = {
  name: "identical — ready",
  render: function Render() {
    return <Live p0="a whole passphrase that fits" r0="a whole passphrase that fits" />;
  },
};
