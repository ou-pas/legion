// Meter = occupation (higher is worse: a goal's budget, elapsed time) · ProgressBar = progress
// (higher is better).
import type { ReactNode } from "react";
import "./meter.css";

export type MeterTone = "accent" | "run" | "wait" | "ok" | "bad";
export type MeterSize = "sm" | "md" | "lg";
/** Past `wait` the meter warns, past `bad` it alarms. */
export interface MeterThresholds {
  wait: number;
  bad: number;
}

const THRESHOLDS: MeterThresholds = { wait: 0.75, bad: 0.9 };
const clamp = (v: number, max: number) => (max > 0 ? Math.min(Math.max(v / max, 0), 1) : 0);

function Track({
  name,
  ratio,
  value,
  max,
  tone,
  size,
  valueText,
}: {
  name: string;
  ratio: number;
  value: number;
  max: number;
  tone: MeterTone;
  size: MeterSize;
  valueText?: string;
}) {
  // oxlint-disable-next-line react/forbid-dom-props -- computed width
  const fill = <span className="ui-meter-fill" style={{ width: `${ratio * 100}%` }} />;
  return (
    <div
      className="ui-meter-track"
      data-tone={tone}
      data-size={size}
      role="progressbar"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
    >
      {fill}
    </div>
  );
}

/** Occupation of a bounded resource. `name` is both the accessible name and the displayed label. */
export function Meter({
  name,
  value,
  max = 100,
  valueLabel,
  valueText,
  tone = "accent",
  thresholds = THRESHOLDS,
  size = "md",
  bare = false,
  className,
}: {
  name: string;
  value: number;
  max?: number;
  /** Rendered right of the label, typically a `<Num>`. */
  valueLabel?: ReactNode;
  /** Spoken reading of the value ("72% of the maximum duration elapsed"). */
  valueText?: string;
  tone?: MeterTone;
  thresholds?: MeterThresholds;
  size?: MeterSize;
  /** The meter alone, no header: the label comes from context (rail, cell). */
  bare?: boolean;
  className?: string;
}) {
  const ratio = clamp(value, max);
  const resolved: MeterTone =
    ratio >= thresholds.bad ? "bad" : ratio >= thresholds.wait ? "wait" : tone;
  return (
    <div className={["ui-meter", className].filter(Boolean).join(" ")}>
      {!bare && (
        <div className="ui-meter-head">
          <span className="ui-meter-label">{name}</span>
          {valueLabel != null && (
            <span className="ui-meter-value" data-tone={resolved}>
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <Track
        name={name}
        ratio={ratio}
        value={value}
        max={max}
        tone={resolved}
        size={size}
        valueText={valueText}
      />
    </div>
  );
}

/** Progress towards completion (DoD 2/4, a goal's steps); turns green when full. */
export function ProgressBar({
  name,
  value,
  max = 100,
  valueLabel,
  valueText,
  tone = "accent",
  size = "md",
  bare = false,
  className,
}: {
  name: string;
  value: number;
  max?: number;
  valueLabel?: ReactNode;
  valueText?: string;
  tone?: MeterTone;
  size?: MeterSize;
  bare?: boolean;
  className?: string;
}) {
  const ratio = clamp(value, max);
  const resolved: MeterTone = ratio >= 1 ? "ok" : tone;
  return (
    <div className={["ui-meter", className].filter(Boolean).join(" ")}>
      {!bare && (
        <div className="ui-meter-head">
          <span className="ui-meter-label">{name}</span>
          {valueLabel != null && (
            <span className="ui-meter-value" data-tone={resolved}>
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <Track
        name={name}
        ratio={ratio}
        value={value}
        max={max}
        tone={resolved}
        size={size}
        valueText={valueText}
      />
    </div>
  );
}
