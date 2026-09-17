// A runner's vitals: the aligned cell grid of the dense card (direction-runners.html, variant A,
// 02/09).
//
// The grid is half the gain: four cells in the same columns on every card, so machines compare
// vertically at a glance, which the old key-value list prevented.
//
// `Vital` knows nothing of its content: a mono capitals label, then what it is given. The places
// cell is here because it is a runner fact like the others, and it names its occupants: "1/2" alone
// forced you to open the board to know who works.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link as RouterLink } from "@tanstack/react-router";
import { Caption } from "../ui/text.js";
import { Link } from "../ui/link.js";
import { Num } from "../ui/num.js";
import { INFRA_TEXT } from "./text.js";
import "./runner-vitals.css";

export function Vitals({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ir-vitals" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function Vital({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="ir-vital">
      <span className="ir-vital-label" title={hint}>
        {label}
      </span>
      {children}
    </div>
  );
}

export type Occupant = {
  taskId: string;
  label: string;
  /** The task's project, copied by the server (batch B). Optional here by tolerance: an occupant
   *  whose project is unknown must never build a dead link; its name becomes plain text. */
  projectId?: string;
};

export function PlacesVital({
  running,
  max,
  occupants,
}: {
  running: number;
  max: number;
  occupants: Occupant[];
}) {
  return (
    <Vital label={INFRA_TEXT.panel.places}>
      <span className="ir-vital-figure">
        <Num value={running} />
        <span className="ir-vital-of">/{max}</span>
      </span>
      {occupants.length === 0 ? (
        <Caption tone="subtle">{INFRA_TEXT.panel.nobody}</Caption>
      ) : (
        occupants.map(({ taskId, label, projectId }) =>
          projectId ? (
            <Link
              key={taskId}
              variant="plain"
              className="ir-vital-occupant"
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/tasks/$taskId"
                  params={{ projectId, taskId }}
                  {...p}
                />
              )}
            >
              <ChevronRight size={11} aria-hidden="true" />
              {label}
            </Link>
          ) : (
            <span key={taskId} className="ir-vital-occupant">
              <ChevronRight size={11} aria-hidden="true" />
              {label}
            </span>
          ),
        )
      )}
    </Vital>
  );
}
