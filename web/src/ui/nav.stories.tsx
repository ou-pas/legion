import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Bot,
  CircleDot,
  Folder,
  FolderGit2,
  GitPullRequest,
  Inbox,
  LayoutGrid,
  Plus,
  Server,
  Shapes,
  Sparkles,
  Target,
} from "lucide-react";
import { Stack } from "./flex.js";
import { NavGroup, NavItem, NavLabel } from "./nav.js";

const meta = { title: "ui / NavItem · NavGroup · NavLabel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const SUB = [
  { label: "Board", Icon: LayoutGrid },
  { label: "Goals", Icon: Target },
  { label: "Issues", Icon: CircleDot },
  { label: "Reviews", Icon: GitPullRequest },
  { label: "Project", Icon: FolderGit2 },
  { label: "Agents", Icon: Bot },
  { label: "Capabilities", Icon: Sparkles },
] as const;

export const RailActiveCountExpand: Story = {
  name: "rail (active, counter, expand)",
  render: function Render() {
    const [openProject, setOpenProject] = useState<string | null>("demo");
    const [sub, setSub] = useState("Board");
    return (
      <Stack gap={10}>
        <div className="dsn-rail">
          <NavLabel>Operate</NavLabel>
          <NavItem icon={<LayoutGrid size={15} />} active>
            Dashboard
          </NavItem>
          <NavItem icon={<Inbox size={15} />} count={2}>
            Inbox
          </NavItem>

          <NavLabel>Projects</NavLabel>
          <NavGroup
            icon={<Folder size={15} />}
            label="Default"
            open={openProject === "default"}
            onOpenChange={(o) => setOpenProject(o ? "default" : null)}
          >
            {SUB.map((s) => (
              <NavItem key={s.label} level="sub" icon={<s.Icon size={14} />}>
                {s.label}
              </NavItem>
            ))}
          </NavGroup>
          <NavGroup
            icon={<Folder size={15} />}
            label="Demo (mock)"
            active
            badge={<span className="dsn-badge">demo</span>}
            open={openProject === "demo"}
            onOpenChange={(o) => setOpenProject(o ? "demo" : null)}
          >
            {SUB.map((s) => (
              <NavItem
                key={s.label}
                level="sub"
                icon={<s.Icon size={14} />}
                active={sub === s.label}
                count={s.label === "Reviews" ? 3 : undefined}
                onClick={() => setSub(s.label)}
              >
                {s.label}
              </NavItem>
            ))}
          </NavGroup>
          <NavItem icon={<Plus size={15} />}>New project</NavItem>

          <NavLabel>System</NavLabel>
          <NavItem icon={<Server size={15} />}>Infra</NavItem>
          <NavItem
            icon={<Shapes size={15} />}
            render={(p) => <a href="#ds-navitem-navgroup-navlabel" {...p} />}
          >
            Design system
          </NavItem>
        </div>
      </Stack>
    );
  },
};

export const LongLabelTruncated: Story = {
  name: "long label, truncated",
  render: () => (
    <Stack gap={10}>
      <div className="dsn-rail">
        <NavItem icon={<FolderGit2 size={15} />} count={12}>
          Stripe Checkout payment tunnel redesign
        </NavItem>
      </div>
    </Stack>
  ),
};
