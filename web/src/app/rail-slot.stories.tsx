// The third state matters most: on a page without sub-navigation there is neither rail nor
// pill, the column disappears and the page takes the width.
//
// The content is a fake navigation: the real ones (`ProjectRailNav`, `SystemRailNav`,
// `WikiRailNav`) take their entries from the router, and a story mounting a router would no
// longer prove anything about the slot itself.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NavItem, NavLabel } from "../ui/nav.js";
import { MainArea, ShellBody } from "../ui/shell.js";
import { Text } from "../ui/text.js";
import { RailSlot } from "./rail-slot.js";

const meta = { title: "app / Rail slot (RailSlot)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function FakeNav() {
  return (
    <>
      <NavLabel>System</NavLabel>
      <NavItem>Runners</NavItem>
      <NavItem>Log</NavItem>
      <NavItem>Analytics</NavItem>
    </>
  );
}

/** Real content, not one sentence: these stories show the width the content receives depending
 *  on the rail state, and a single line does not show it. */
function Body({ children }: { children: React.ReactNode }) {
  return (
    <ShellBody>
      {children}
      <MainArea>
        <Text as="p">
          <strong>Decisions made</strong>
        </Text>
        <Text as="p">
          What the product has settled, and why. The reasons matter as much as the conclusions:
          without them, the same debate happens again three months later, and what was already
          learned is lost.
        </Text>
        <Text as="p" tone="muted">
          A wiki page, to see the width the column gets depending on whether the rail is there,
          collapsed, or absent.
        </Text>
      </MainArea>
    </ShellBody>
  );
}

export const WithNavigation: Story = {
  name: "with navigation — the rail carries the page's own",
  render: () => (
    <Body>
      <RailSlot nav={<FakeNav />} collapsed={false} name="System" onToggle={() => {}} />
    </Body>
  ),
};

export const Collapsed: Story = {
  name: "collapsed — the pill replaces the rail",
  render: () => (
    <Body>
      <RailSlot nav={<FakeNav />} collapsed name="System" onToggle={() => {}} />
    </Body>
  ),
};

export const WithoutNavigation: Story = {
  name: "without navigation — no rail and no pill, the page takes the width",
  render: () => (
    <Body>
      <RailSlot nav={null} collapsed={false} name="Legion" onToggle={() => {}} />
    </Body>
  ),
};

export const Live: Story = {
  name: "live — collapse then reopen",
  render: function Render() {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <Body>
        <RailSlot
          nav={<FakeNav />}
          collapsed={collapsed}
          name="System"
          onToggle={() => setCollapsed((c) => !c)}
        />
      </Body>
    );
  },
};
