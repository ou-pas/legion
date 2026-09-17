// The phone tab bar only appears at the `compact` tier (<= 640px): in the workshop, shrink the
// window or use the viewport toolbar. Deliberate: driving its display from a prop rather than
// CSS would put two sources of truth on the same question, and the viewport is right.
//
// Links are inert `<a>`, not `<Link>`: the preview router has only a root route, so
// `/p/$projectId/board` would match nothing. That is why the component takes a `render` (same
// reason as `ui/nav.tsx` and `projects/project-rail.tsx`).
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowLeft, Bot, Inbox, LayoutGrid, MessagesSquare, Settings, Target } from "lucide-react";
import { HOME_TAB, TabBar, type TabDef } from "./tab-bar.js";

const meta = { title: "app / Tab bar (TabBar)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** A project level: what `railRowsFor` returns outside a section. Seven rows, enough for the
 *  bar to overflow and scroll. */
const PROJECT: TabDef[] = [
  { to: "/board", label: "Board", Icon: LayoutGrid },
  { to: "/channels", label: "Channels", Icon: MessagesSquare },
  { to: "/inbox", label: "Inbox", Icon: Inbox },
  { to: "/goals", label: "Goals", Icon: Target },
  { to: "/agents", label: "Agents", Icon: Bot },
  { to: "/settings", label: "Settings", Icon: Settings },
];

/** The level of a SECTION: a back row up top, like `SETTINGS_ROWS`. */
const SETTINGS: TabDef[] = [
  { to: "/board", label: "Project", Icon: ArrowLeft, back: true },
  { to: "/general", label: "General", Icon: Settings },
  { to: "/repos", label: "Repos", Icon: Bot },
  { to: "/secrets", label: "Secrets", Icon: Target },
  { to: "/models", label: "Models", Icon: Inbox },
];

const inert = (to: string, props: { className: string; children: React.ReactNode }) => (
  <a href="#" data-to={to} {...props} />
);

export const ProjectLevel: Story = {
  name: "the level of a project — six rows, the bar scrolls",
  render: () => <TabBar rows={PROJECT} render={inert} here="/board" />,
};

export const CurrentTab: Story = {
  name: "current tab — the ink marks it, never a solid background",
  render: () => (
    <TabBar
      rows={PROJECT}
      render={(to, props) => (
        <a
          href="#"
          data-to={to}
          {...props}
          className={to === "/inbox" ? `${props.className} is-active` : props.className}
        />
      )}
      here="/inbox"
    />
  ),
};

export const SectionLevel: Story = {
  name: "inside a section — the back row is pinned, the rest scrolls",
  render: () => <TabBar rows={SETTINGS} render={inert} here="/general" />,
};

export const OutsideProject: Story = {
  name: "outside a project — the exit, then the System sections",
  render: () => (
    <TabBar
      rows={[
        HOME_TAB,
        { to: "/system/general", label: "General", Icon: Settings },
        { to: "/system/runners", label: "Runners", Icon: Bot },
        { to: "/system/logs", label: "Log", Icon: Inbox },
      ]}
      render={inert}
      here="/system/general"
    />
  ),
};
