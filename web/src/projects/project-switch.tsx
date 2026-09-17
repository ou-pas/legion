// Switching project: the menu, separate from its two triggers (14/09).
//
// It used to live inside the rail head. The phone needed it too: at the compact tier the icon rail
// and the project rail leave the flow, so there was no path left from one project to another.
// Copying the list into the bar would have made two, and two lists of one fact diverge.
//
// The menu is shared; what you press differs. The rail shows the project head, the bar its square
// and name, hence a `trigger` child rather than a variant boolean (rule 5 of the design contract).
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { bootstrapQuery } from "../queries.js";
import { Menu, MenuItem } from "../ui/menu.js";
import { ProjectSquare } from "./project-rail.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";

export function ProjectSwitch({
  trigger,
  className,
  align = "start",
}: {
  trigger: ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const { data: boot } = useQuery(bootstrapQuery);
  const navigate = useNavigate();
  return (
    <Menu label={PROJECT_TEXT.rail.switch} trigger={trigger} className={className} align={align}>
      {(boot?.projects ?? []).map((p) => (
        <MenuItem
          key={p.id}
          icon={<ProjectSquare project={p} size="sm" />}
          onSelect={() => void navigate({ to: "/p/$projectId/board", params: { projectId: p.id } })}
        >
          {p.name}
        </MenuItem>
      ))}
    </Menu>
  );
}
