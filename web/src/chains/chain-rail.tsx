// A chain run's flow as a vertical rail, one node per real task, in `stepIndex` order. A chain is
// linear (step N+1 blocked by N): no topological sort, no graph layout, and the connecting line is
// dependency-free SVG (`Track`, below). The node lives in `chain-rail-node.tsx`.
import { ChainRailNode, type ChainRailStep } from "./chain-rail-node.js";
import { TASK_CHIP } from "../tasks/task-status.js";
import "./chain-rail.css";

export function ChainRail({ steps, label }: { steps: ChainRailStep[]; label: string }) {
  return (
    <ol className="dm-chain-rail" aria-label={label}>
      {steps.map((step, i) => (
        <li key={step.task.id} className="dm-chain-row">
          <Track
            state={TASK_CHIP[step.task.status]}
            first={i === 0}
            last={i === steps.length - 1}
          />
          <ChainRailNode {...step} />
        </li>
      ))}
    </ol>
  );
}

/** Marker and connecting line, one `<svg>` per row, without `viewBox`: `%` coordinates resolve
 *  against the element's real size (`height: 100%` in CSS), so the line follows a card of variable
 *  height with no JS measurement. */
function Track({ state, first, last }: { state: string; first: boolean; last: boolean }) {
  return (
    <svg className="dm-chain-track" data-state={state} aria-hidden="true" focusable="false">
      {!first && <line className="dm-chain-track-line" x1="50%" y1="0" x2="50%" y2="50%" />}
      {!last && <line className="dm-chain-track-line" x1="50%" y1="50%" x2="50%" y2="100%" />}
      <circle className="dm-chain-track-dot" cx="50%" cy="50%" r="5" />
    </svg>
  );
}
