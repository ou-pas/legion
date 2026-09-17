// The rail head: a mark and a name, the same for all three rails.
//
// It used to live in `projects/` and only existed for a project: the system had a small-caps label,
// the wiki nothing. Three treatments for one position, although slice nav/05 made the rail one
// thing, the navigation of where you are.
//
// The mark is a child: a project passes its initials on its tint (`ProjectSquare size="sm"`), a
// global section a drawn icon on a neutral surface (`RailHeadMark`). The component knows neither
// projects nor lucide, which is the only reason it can live in `ui/`.
import type { ReactNode } from "react";
import "./rail-head.css";

export function RailHead({
  mark,
  name,
  sub,
  size = "md",
}: {
  mark: ReactNode;
  name: string;
  sub?: string;
  /** `lg` (04/09): a global section's head (System, Wiki, Concierge) reads as a title, larger than
   *  a project name in the same spot. A global section is the place itself (operator: without a
   *  project name above, a project-sized name "looked odd"). */
  size?: "md" | "lg";
}) {
  // The second segment is optional, which is what makes it acceptable here: system and wiki have
  // nothing to put after their name, and without `sub` the render is unchanged.
  //
  // It exists because a project's rail is replaced when entering a section (slice nav/09): once the
  // screen list is replaced by Settings, nothing says which project you are in.
  const full = sub ? `${name} · ${sub}` : name;
  return (
    <div className="ui-rail-head" data-size={size}>
      {mark}
      {/* `title`: the name truncates when long, and this is the only place in the column where it
          is written in full. */}
      <span className="ui-rail-head-name" title={full}>
        {name}
        {sub && <span className="ui-rail-head-sub"> · {sub}</span>}
      </span>
    </div>
  );
}

/** A drawn icon on a neutral surface. Neutral because the tint is what tells projects apart: the
 *  system is not one more project. */
export function RailHeadMark({ children }: { children: ReactNode }) {
  return (
    <span className="ui-rail-head-mark" aria-hidden="true">
      {children}
    </span>
  );
}
