// What needs a decision (gate) or was refused (bad) gets hatching on its edge, not a thick border
// (banned).
import type { ReactNode } from "react";
import "./hatch.css";

/** gate = waiting for you · bad = refused / blocked · neutral = set aside (draft, archive). */
export type HatchTone = "gate" | "bad" | "neutral";

export function Hatch({
  tone = "gate",
  icon,
  side = "left",
  className,
  children,
}: {
  tone?: HatchTone;
  /** Stamp for a gate, ShieldX for a refusal. */
  icon?: ReactNode;
  side?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-hatch", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-side={side}
    >
      <span className="ui-hatch-edge" aria-hidden="true">
        {icon}
      </span>
      <div className="ui-hatch-body">{children}</div>
    </div>
  );
}
