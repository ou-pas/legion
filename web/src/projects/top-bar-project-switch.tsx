// The project selector in the bar, at the phone tier only (14/09).
//
// Its own file because the harness required it: `project.tsx` imports the shared menu for its rail
// head, so a menu reading `useProject()` would close a cycle, and `tsPreCompilationDeps` makes that
// a build error. The menu only knows what it is given; this module knows where to find the open
// project.
import { ChevronDown } from "lucide-react";
import { ProjectSquare } from "./project-rail.js";
import { ProjectSwitch } from "./project-switch.js";
import { useProject } from "./project.js";
/** The same menu, in the bar, at the phone tier only (14/09, then 44px for fingers the same day,
 *  operator feedback: "a bit small").
 *
 *  It reads the project itself rather than receive it: the shell then carries no condition or prop
 *  for it (it already had fifteen, and one more pushed `Layout` over the repository's complexity
 *  cap).
 *
 *  The name now shows next to the square: the trigger only carried a mark and a chevron, without
 *  saying which project. The selector takes 50% of the bar to make room (`ui-topbar-switch`,
 *  shell.css); the screen title on the right truncates, as it already does for a long title. */
export function TopBarProjectSwitch() {
  const { project } = useProject();
  if (!project) return null;
  return (
    <ProjectSwitch
      className="ui-topbar-switch"
      trigger={
        <>
          <ProjectSquare project={project} size="sm" />
          <span className="ui-topbar-switch-name">{project.name}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </>
      }
    />
  );
}
