// Every state of the icon rail, in the column it really lives in. The column matters as much as
// the square: a 34 px square in a 56 px band is the mock-up's geometry (direction-double-nav,
// variant B), hence `IconRail` around each story rather than a bare background.
//
// No story passes `render`: navigation belongs to the router, and a story mounting a router
// would no longer prove anything about the square.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { IconRail } from "../ui/shell.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { ProjectRail, ProjectSquare } from "./project-rail.js";

const meta = { title: "projects / Icon rail (ProjectRail)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LEGION = { id: "ag7Kx2Lm01", name: "Legion" };
const KOPEE = { id: "kp9Ax2Lm01", name: "Kopee.me" };
const ACME = { id: "op4Zt8Qr56", name: "acme" };

export const TwoProjects: Story = {
  name: "two projects, nothing waiting",
  render: () => (
    <IconRail label="Projets">
      <ProjectRail projects={[LEGION, KOPEE]} currentId={LEGION.id} onAdd={() => {}} />
    </IconRail>
  ),
};

export const WithBadges: Story = {
  name: "decisions are waiting",
  render: () => (
    <IconRail label="Projets">
      <ProjectRail
        projects={[LEGION, KOPEE, ACME]}
        currentId={LEGION.id}
        pending={{ [KOPEE.id]: 2, [ACME.id]: 14 }}
        onAdd={() => {}}
      />
    </IconRail>
  ),
};

export const OutsideProject: Story = {
  name: "no project open (global surface)",
  render: () => (
    <IconRail label="Projets">
      <ProjectRail
        projects={[LEGION, KOPEE]}
        currentId={null}
        pending={{ [KOPEE.id]: 1 }}
        onAdd={() => {}}
      />
    </IconRail>
  ),
};

export const Empty: Story = {
  name: "no project — the button alone",
  render: () => (
    <IconRail label="Projets">
      <ProjectRail projects={[]} onAdd={() => {}} />
    </IconRail>
  ),
};

export const Adding: Story = {
  name: "the add button responds",
  render: function Render() {
    const [clicks, setClicks] = useState(0);
    return (
      <Stack gap={12}>
        <IconRail label="Projets">
          <ProjectRail
            projects={[LEGION]}
            currentId={LEGION.id}
            onAdd={() => setClicks((n) => n + 1)}
          />
        </IconRail>
        <Text tone="muted">Modal opens requested: {clicks}</Text>
      </Stack>
    );
  },
};

export const Scale: Story = {
  name: "the twelve-hue scale",
  render: () => (
    <Stack gap={12}>
      <Text tone="muted">
        A project doesn't choose its color: its identifier is hashed across twelve steps declared in
        the tokens. Twelve similar names, twelve different identifiers.
      </Text>
      <IconRail label="Projets">
        {Array.from({ length: 12 }, (_, i) => (
          <ProjectSquare key={i} project={{ id: `demo-${i}`, name: `Project ${i}` }} />
        ))}
      </IconRail>
    </Stack>
  ),
};

export const Initials: Story = {
  name: "initials, edge cases",
  render: () => (
    <IconRail label="Projets">
      <ProjectSquare project={{ id: "a1", name: "Legion" }} />
      <ProjectSquare project={{ id: "b2", name: "kopee.me" }} />
      <ProjectSquare project={{ id: "c3", name: "  acme" }} />
      <ProjectSquare project={{ id: "d4", name: "Case study" }} />
      <ProjectSquare project={{ id: "e5", name: "···" }} />
    </IconRail>
  ),
};
