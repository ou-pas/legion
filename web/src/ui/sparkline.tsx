// A recent trend in one stroke, no axis or legend (Tufte). Added for a runner's card (v52, 02/09):
// "is usage rising?" answered at a glance, where a number only gives the present.
//
// Knows nothing of the domain: the caller (`infra/runner-metrics.tsx`) names the axis and picks the
// tone.
import { UI_TEXT } from "./vocabulary.js";
import "./sparkline.css";

export interface SparklinePoint {
  at: number;
  value: number | null;
}
export type SparklineTone = "accent" | "run" | "wait" | "ok" | "bad";

/** Groups of consecutive indices with a usable value. A missing measure breaks the stroke rather
 *  than interpolating: joining points across a gap would claim a trend that was not measured. */
function runsOf(points: SparklinePoint[]): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  points.forEach((p, i) => {
    if (p.value === null || !Number.isFinite(p.value)) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    current.push(i);
  });
  if (current.length) runs.push(current);
  return runs;
}

/** `null` when there is nothing usable: fewer than two valid points is not a trend, and the caller
 *  must be able to show something else ("no history yet") instead of an empty SVG. */
export function Sparkline({
  name,
  points,
  tone = "accent",
  width = 96,
  height = 24,
  className,
}: {
  name: string;
  points: SparklinePoint[];
  tone?: SparklineTone;
  width?: number;
  height?: number;
  className?: string;
}) {
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length < 2) return null;

  const min = Math.min(...values),
    max = Math.max(...values);
  const span = max - min || 1;
  const n = points.length;
  const toXY = (i: number): [number, number] => [
    n > 1 ? (i / (n - 1)) * width : width / 2,
    height - ((points[i]!.value! - min) / span) * height,
  ];
  const runs = runsOf(points).filter((r) => r.length >= 2);
  const last = values.at(-1)!;

  return (
    <svg
      className={["ui-sparkline", className].filter(Boolean).join(" ")}
      data-tone={tone}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={UI_TEXT.sparkline(name, Math.round(last))}
    >
      {runs.map((run) => (
        <polyline
          key={run[0]}
          className="ui-sparkline-line"
          points={run.map((i) => toXY(i).join(",")).join(" ")}
        />
      ))}
    </svg>
  );
}
