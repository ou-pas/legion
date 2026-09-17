// AppShell, TopBar, IconRail, Rail, MainArea, RailReopen. Three states, the only three geometries
// the app lays out: expanded, collapsed, and without a project rail (bootstrap screen, when no
// project exists).
//
// A fourth story for the phone tools panel (14/09, touch audit). `TopBarTools` does not expose its
// `open` (deliberately, nothing outside has to drive it), so the story clicks its own trigger on
// mount rather than adding a prop only it would use.
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Bell,
  Book,
  LayoutGrid,
  MessagesSquare,
  Search,
  Settings,
  Sun,
  Target,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavItem, NavLabel } from "./nav.js";
import {
  AppShell,
  Avatar,
  IconRail,
  Logo,
  MainArea,
  Rail,
  RailReopen,
  ShellBody,
  TopBar,
  TopBarTools,
} from "./shell.js";
import { IconButton } from "./button.js";
import { Divider } from "./divider.js";
import { Spacer, Stack } from "./flex.js";
import { Heading } from "./heading.js";
import { Text } from "./text.js";

const meta = { title: "ui / Shell" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The router's rail content, shortened: slice 01 touches nothing it contains, only the column
 *  carrying it. */
function RailContent() {
  return (
    <>
      <NavLabel>Operate</NavLabel>
      <NavItem icon={<LayoutGrid size={15} />}>Board</NavItem>
      <NavItem icon={<MessagesSquare size={15} />}>Channels</NavItem>
      <NavItem icon={<Target size={15} />}>Goals</NavItem>
      <NavItem icon={<Settings size={15} />}>Settings</NavItem>
    </>
  );
}

function Bar() {
  return (
    <TopBar>
      <Logo>Legion</Logo>
      <Spacer />
      <Avatar initial="R" name="Operator" />
    </TopBar>
  );
}

/** Content, not a sentence: the shell is judged by the room it leaves, and a lone paragraph shows
 *  neither the column nor what collapsing gives back. */
function Body({ children }: { children?: ReactNode }) {
  return (
    <MainArea>
      <Stack gap={6}>
        <Heading level={1}>Board</Heading>
        <Text>The open project's content fills the remaining column.</Text>
        <Text tone="muted">Collapsing the rail gives it back 224px, at no cost to wayfinding.</Text>
        {children}
      </Stack>
    </MainArea>
  );
}

export const Expanded: Story = {
  name: "expanded — icon rail, project rail, content",
  render: () => (
    <AppShell>
      <Bar />
      <ShellBody>
        <IconRail label="Projets" />
        <RailReopen collapsed={false} name="Legion" onOpen={() => {}} />
        <Rail collapsed={false} onCollapse={() => {}}>
          <RailContent />
        </Rail>
        <Body />
      </ShellBody>
    </AppShell>
  ),
};

export const Collapsed: Story = {
  name: "collapsed — the project rail is gone, the pill reopens it",
  render: () => (
    <AppShell>
      <Bar />
      <ShellBody>
        <IconRail label="Projets" />
        <RailReopen collapsed name="Legion" onOpen={() => {}} />
        <Rail collapsed onCollapse={() => {}}>
          <RailContent />
        </Rail>
        <Body />
      </ShellBody>
    </AppShell>
  ),
};

export const Toggle: Story = {
  name: "the toggle, both ways",
  render: function Render() {
    const [collapsed, setCollapsed] = useState(false);
    const toggle = () => setCollapsed((c) => !c);
    return (
      <AppShell>
        <Bar />
        <ShellBody>
          <IconRail label="Projets" />
          <RailReopen collapsed={collapsed} name="Legion" onOpen={toggle} />
          <Rail collapsed={collapsed} onCollapse={toggle}>
            <RailContent />
          </Rail>
          <Body />
        </ShellBody>
      </AppShell>
    );
  },
};

export const WithoutProjectRail: Story = {
  name: "without a project rail — no project open",
  render: () => (
    <AppShell>
      <Bar />
      <ShellBody>
        <IconRail label="Projets" />
        <Body>
          <Text tone="muted">No project open: nothing to navigate, so no rail.</Text>
        </Body>
      </ShellBody>
    </AppShell>
  ),
};

/** The collapsed panel's content: six 44px targets (wiki, system, search, assistant, then both
 *  toggles). Same shape the router composes, reduced to generic icons: the shell knows none of
 *  these domains. */
function ToolsContent() {
  return (
    <>
      <span className="ui-topbar-poste">
        <IconButton title="Wiki" variant="quiet">
          <Book size={17} />
        </IconButton>
        <IconButton title="System" variant="quiet">
          <Settings size={17} />
        </IconButton>
      </span>
      <IconButton title="Search" variant="quiet">
        <Search size={17} />
      </IconButton>
      <Divider orientation="vertical" space="sm" />
      <IconButton title="Assistant" variant="quiet">
        <MessagesSquare size={17} />
      </IconButton>
      <Divider orientation="vertical" space="sm" />
      <IconButton title="Theme" variant="quiet">
        <Sun size={17} />
      </IconButton>
      <IconButton title="Notifications" variant="quiet">
        <Bell size={17} />
      </IconButton>
    </>
  );
}

export const ToolsOpen: Story = {
  name: 'collapsed tools — the panel open (phone tier, 44px, on the "…" axis)',
  render: function Render() {
    // Open the panel on mount: `TopBarTools` keeps `open` internal, and the real gesture is a press
    // on the trigger.
    const wrap = useRef<HTMLDivElement>(null);
    useEffect(() => {
      wrap.current?.querySelector<HTMLButtonElement>(".ui-topbar-tools-toggle")?.click();
    }, []);
    return (
      <div ref={wrap}>
        <AppShell>
          <TopBar>
            <Logo>Legion</Logo>
            <Spacer />
            <TopBarTools>
              <ToolsContent />
            </TopBarTools>
          </TopBar>
          <ShellBody>
            <IconRail label="Projets" />
            <Body />
          </ShellBody>
        </AppShell>
      </div>
    );
  },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
