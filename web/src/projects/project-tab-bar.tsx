// The phone bar for a project: the same list as the rail, laid flat.
//
// It lives in `projects/`, not `app/`: it reads a project path, derives the list for where you are,
// and builds links carrying `projectId` and `taskId`. `app/tab-bar.tsx` only provides geometry.
//
// The list is not copied: `railRowsFor(pathname)` is the function the rail calls, so a renamed or
// moved entry changes in both places at once.
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { TabBar } from "../app/tab-bar.js";
import { railRowsFor } from "./rail-sections.js";
import { useProject } from "./project.js";

const ACTIVE = { className: "is-active" };

export function ProjectTabBar() {
  const { project } = useProject();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // A task's views need its id besides the project's. Read from the URL, like `ProjectRailNav`;
  // `strict: false` because the shell mounts this component on every project route.
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const { rows } = railRowsFor(pathname);
  if (!project) return null;
  return (
    <TabBar
      here={pathname}
      rows={rows}
      render={(to, props) => (
        <Link to={to} params={{ projectId: project.id, taskId }} activeProps={ACTIVE} {...props} />
      )}
    />
  );
}
