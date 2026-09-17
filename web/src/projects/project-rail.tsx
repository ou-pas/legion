// The icon rail: one square per project, the open one marked, and the number of waiting decisions
// stitched to the corner (direction-double-nav mock-up, variant B).
//
// It lives in `projects/`, not `ui/`: a square drawing its letters from a project name and reading
// a count per project id knows the domain. `ui/shell.tsx` only provides the column (`IconRail`).
//
// It does not know the router, same rule as `ui/nav.tsx`: `render` receives the computed class and
// content, and the caller provides its <Link>. That makes stories possible without a router.
import type { ReactElement, ReactNode } from "react";
import { Plus } from "lucide-react";
import { projectMark } from "./project-mark.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";
import "./project-rail.css";

/** `hue` is the hue chosen in settings (v47), absent or `null` most of the time: derivation from
 *  name/id stays the default, and the rail need not know which of the two it shows. */
export type RailProject = { id: string; name: string; hue?: number | null };

interface MarkRender {
  /** The project first, because the caller needs it to build its link; computed props next, like
   *  `ui/nav.tsx`. */
  (
    project: RailProject,
    props: {
      className: string;
      children: ReactNode;
      title: string;
      /** The rank on the hue scale, turned into a colour by CSS. Travels in props so the caller
       *  neither knows the hash nor picks a colour. */
      "data-hue": number;
      "aria-current"?: "page";
    },
  ): ReactElement;
}

export function ProjectRail({
  projects,
  currentId = null,
  pending = {},
  onAdd,
  render,
}: {
  projects: RailProject[];
  /** The open project, or `null` on a global surface: no square is marked then. */
  currentId?: string | null;
  /** What is stopped, per project id (`/api/inbox/pending-by-project`). Absent or zero: no pill. A
   *  counter showing "0" is a counter people stop reading. */
  pending?: Record<string, number>;
  onAdd: () => void;
  /** E.g. `render={(p, props) => <Link to="/p/$projectId/board" params={{ projectId: p.id }} {...props} />}`.
   *  Without it the squares are inert marks, which is what stories do. */
  render?: MarkRender;
}) {
  return (
    <>
      {projects.map((p) => (
        <ProjectSquare
          key={p.id}
          project={p}
          current={p.id === currentId}
          pending={pending[p.id] ?? 0}
          render={render}
        />
      ))}
      <button type="button" className="prj-add" onClick={onAdd} aria-label={PROJECT_TEXT.rail.add}>
        <Plus aria-hidden="true" />
      </button>
    </>
  );
}

/** A square. Exported for stories and for the project rail head, which carries the same mark
 *  smaller: two places, one derivation. */
export function ProjectSquare({
  project,
  current = false,
  pending = 0,
  size = "md",
  render,
}: {
  project: RailProject;
  current?: boolean;
  pending?: number;
  /** `sm`: the same mark at the top of the project rail, next to the name written out. */
  size?: "sm" | "md";
  render?: MarkRender;
}) {
  const mark = projectMark(project.name, project.id, project.hue);
  // The hue travels as an attribute, not a computed style: the rank comes from a hash, the twelve
  // colours live in `ui/tokens.css`, and neither half needs the other.
  const cls = ["prj", size === "sm" && "prj-sm", current && "is-current"].filter(Boolean).join(" ");
  const body = (
    <>
      <span className="prj-initials">{mark.initials}</span>
      {pending > 0 && (
        // `aria-label` on the pill: "2" alone does not say of what, and that is exactly what
        // decides whether you click.
        <span className="prj-badge" aria-label={PROJECT_TEXT.rail.pending(pending)}>
          {pending}
        </span>
      )}
    </>
  );
  const shared = {
    className: cls,
    title: project.name,
    "data-hue": mark.hue,
    "aria-current": current ? ("page" as const) : undefined,
  };
  if (render) return render(project, { ...shared, children: body });
  // Without `render` the square is not interactive: a mark, not a fake button leading nowhere.
  // `role="img"` + `aria-label` so it still reads, except in `sm`, where the project name is written
  // right next to it and announcing it twice is noise.
  return size === "sm" ? (
    <span {...shared} aria-hidden="true">
      {body}
    </span>
  ) : (
    <span {...shared} role="img" aria-label={project.name}>
      {body}
    </span>
  );
}
