// The heads of the THREE rails one under the other: the only way to see they are one. Apart, each
// looked right; side by side the asymmetry showed (the project with its mark and name, the system
// with a small-caps label).
//
// The rail around, like the icon rail stories: a 22 px head in a 240 px column is the geometry
// being checked, not a component on a bare background.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowLeft, Book, ChevronDown, Settings } from "lucide-react";
import { NavItem, NavLabel } from "./nav.js";
import { Rail } from "./shell.js";
import { RailHead, RailHeadMark } from "./rail-head.js";
import { Menu, MenuItem } from "./menu.js";
import { ProjectSquare } from "../projects/project-rail.js";
// The back row's class lives with the project rail; the story imports it to show the real drawing
// (an accent arrow and some breathing room before the list) rather than a bare row.
import "../projects/rail-sections.css";

const meta = { title: "ui / Rail head (RailHead)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LEGION = { id: "ag7Kx2Lm01", name: "Legion" };
const KOPEE = { id: "kp9Ax2Lm01", name: "Kopee.me" };

/** A whole rail rather than a lone head: the head is made to be read BEFORE entries, and its bottom
 *  spacing can only be judged against them. */
function InRail({ head, items }: { head: React.ReactNode; items: string[] }) {
  return (
    <Rail collapsed={false} onCollapse={() => {}}>
      {head}
      <NavLabel>Navigation</NavLabel>
      {items.map((i) => (
        <NavItem key={i}>{i}</NavItem>
      ))}
    </Rail>
  );
}

export const ProjectHead: Story = {
  name: "project — its initials on its hue",
  render: () => (
    <InRail
      head={<RailHead mark={<ProjectSquare project={LEGION} size="sm" />} name={LEGION.name} />}
      items={["Board", "Channels", "Goals", "Reviews", "Agents"]}
    />
  ),
};

/** The rail that replaced itself (slice nav/09): the only state where the head carries two
 *  segments, judged only with the list below. Once the project screens are replaced by the Settings
 *  topics, this line is the only place still saying which project one works in.
 *
 *  The list goes EDGE TO EDGE, no vertical rule, no indent. A rule would say "this belongs to what
 *  is above", but the parent moved into the head and the rule would hang on nothing. The back row
 *  comes first and names its DESTINATION. */
export const ProjectSection: Story = {
  name: "project · section — the rail swapped itself",
  render: () => (
    <Rail collapsed={false} onCollapse={() => {}}>
      <RailHead
        mark={<ProjectSquare project={LEGION} size="sm" />}
        name={LEGION.name}
        sub="Settings"
      />
      <NavItem className="prj-rail-back" icon={<ArrowLeft size={15} />}>
        Project
      </NavItem>
      {[
        "Repos",
        "Context",
        "Models",
        "Chains",
        "Secrets & identity",
        "Execution",
        "Vault",
        "Danger",
      ].map((i) => (
        <NavItem key={i}>{i}</NavItem>
      ))}
    </Rail>
  ),
};

export const SystemHead: Story = {
  name: "system — an icon drawn on a neutral surface",
  render: () => (
    <InRail
      head={
        <RailHead
          mark={
            <RailHeadMark>
              <Settings size={13} />
            </RailHeadMark>
          }
          name="System"
        />
      }
      items={["Runners", "Log", "Analytics", "Models"]}
    />
  ),
};

export const Wiki: Story = {
  name: "wiki — the same head, a different icon",
  render: () => (
    <InRail
      head={
        <RailHead
          mark={
            <RailHeadMark>
              <Book size={13} />
            </RailHeadMark>
          }
          name="Wiki"
        />
      }
      items={["Home", "Concepts", "Guides", "Reference"]}
    />
  ),
};

export const AllThree: Story = {
  name: "all three side by side — a single head",
  render: () => (
    <>
      <InRail
        head={<RailHead mark={<ProjectSquare project={LEGION} size="sm" />} name={LEGION.name} />}
        items={["Board", "Channels", "Goals"]}
      />
      <InRail
        head={<RailHead mark={<ProjectSquare project={KOPEE} size="sm" />} name={KOPEE.name} />}
        items={["Board", "Channels", "Goals"]}
      />
      <InRail
        head={
          <RailHead
            mark={
              <RailHeadMark>
                <Settings size={13} />
              </RailHeadMark>
            }
            name="System"
          />
        }
        items={["Runners", "Log", "Analytics"]}
      />
      <InRail
        head={
          <RailHead
            mark={
              <RailHeadMark>
                <Book size={13} />
              </RailHeadMark>
            }
            name="Wiki"
          />
        }
        items={["Home", "Concepts", "Guides"]}
      />
    </>
  ),
};

/** The head becomes the project menu trigger (04/09): a chevron NEXT TO the head, not inside; both
 *  are direct children of the button, each centred on ITS height. The head keeps its asymmetric
 *  vertical padding (room for the list below when standalone), neutralised here for this
 *  composition only; without this story, a badge and name 4px off under the chevron only showed on
 *  hover, when the row background makes the gap comparable. */
export const ProjectOpensMenu: Story = {
  name: "project — the chevron that opens the projects menu",
  render: () => (
    <Rail collapsed={false} onCollapse={() => {}}>
      <Menu
        label="Switch project"
        trigger={
          <>
            <RailHead mark={<ProjectSquare project={LEGION} size="sm" />} name={LEGION.name} />
            <ChevronDown size={14} aria-hidden="true" className="prj-rail-switch-chevron" />
          </>
        }
        className="prj-rail-switch"
        align="start"
      >
        <MenuItem icon={<ProjectSquare project={LEGION} size="sm" />}>{LEGION.name}</MenuItem>
        <MenuItem icon={<ProjectSquare project={KOPEE} size="sm" />}>{KOPEE.name}</MenuItem>
      </Menu>
      <NavLabel>Navigation</NavLabel>
      {["Board", "Channels", "Goals"].map((i) => (
        <NavItem key={i}>{i}</NavItem>
      ))}
    </Rail>
  ),
};

export const LongName: Story = {
  name: "long name — it truncates, it doesn't push the column",
  render: () => (
    <InRail
      head={
        <RailHead
          mark={
            <ProjectSquare
              project={{ id: "lg1", name: "A project with a name so long it overflows" }}
              size="sm"
            />
          }
          name="A project with a name so long it overflows"
        />
      }
      items={["Board", "Channels", "Goals"]}
    />
  ),
};
