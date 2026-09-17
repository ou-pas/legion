// A goal's guardrails: what stops it if the loop drifts. Bounded rails use <Meter> (occupancy: the
// higher, the worse); what has no cap invents no gauge and stays a key/value pair.
import type { ReactNode } from "react";
import { KeyValue, KeyValueList } from "../ui/key-value.js";
import { Meter } from "../ui/meter.js";
import { Num } from "../ui/num.js";
import { Text } from "../ui/text.js";
import { GOAL_TEXT } from "./text.js";
import "./guardrails.css";

const MIN = 60_000;

/** "$6.42 / $25.00": two mono measures, the slash stays text. */
function money(value: number, max?: number | null): ReactNode {
  const spent = <Num value={value.toFixed(2)} prefix="$" />;
  if (max == null) return spent;
  return (
    <>
      {spent} / <Num value={max.toFixed(2)} prefix="$" />
    </>
  );
}

function minutes(ms: number): ReactNode {
  return <Num value={Math.round(ms / MIN)} suffix="min" />;
}

export function Guardrails({
  spentUsd,
  budgetUsd,
  elapsedMs,
  maxDurationMs,
  noProgressStreak,
  maxNoProgress,
  iterations,
  plannedSteps,
  className,
}: {
  spentUsd: number;
  /** null = no spending cap. */
  budgetUsd: number | null;
  elapsedMs: number;
  /** null = no duration limit. */
  maxDurationMs: number | null;
  noProgressStreak: number;
  maxNoProgress: number;
  iterations: number;
  /** Steps in the approved plan: beyond that, the orchestrator drifted. */
  plannedSteps?: number;
  className?: string;
}) {
  const drift = plannedSteps !== undefined && plannedSteps > 0 && iterations > plannedSteps;
  return (
    <div className={["dm-rails", className].filter(Boolean).join(" ")}>
      {budgetUsd !== null && (
        <Meter
          name={GOAL_TEXT.rails.budget}
          value={spentUsd}
          max={budgetUsd}
          valueLabel={money(spentUsd, budgetUsd)}
          valueText={GOAL_TEXT.rails.budgetSpoken(spentUsd.toFixed(2), budgetUsd.toFixed(2))}
        />
      )}
      {maxDurationMs !== null && (
        <Meter
          name={GOAL_TEXT.rails.duration}
          value={elapsedMs}
          max={maxDurationMs}
          valueLabel={
            <>
              {minutes(elapsedMs)} / {minutes(maxDurationMs)}
            </>
          }
          valueText={GOAL_TEXT.rails.durationSpoken(
            Math.round(elapsedMs / MIN),
            Math.round(maxDurationMs / MIN),
          )}
        />
      )}
      <Meter
        name={GOAL_TEXT.rails.noProgress}
        value={noProgressStreak}
        max={maxNoProgress}
        tone="wait"
        valueLabel={<Num value={`${noProgressStreak} / ${maxNoProgress}`} />}
        valueText={GOAL_TEXT.rails.noProgressSpoken(noProgressStreak, maxNoProgress)}
      />
      <KeyValueList variant="stacked" density="compact" label={GOAL_TEXT.rails.unbounded}>
        {budgetUsd === null && (
          <KeyValue label={GOAL_TEXT.rails.budget} hint={GOAL_TEXT.rails.noBudget}>
            {money(spentUsd)}
          </KeyValue>
        )}
        {maxDurationMs === null && (
          <KeyValue label={GOAL_TEXT.rails.duration} hint={GOAL_TEXT.rails.noLimit}>
            {minutes(elapsedMs)}
          </KeyValue>
        )}
        <KeyValue
          label={GOAL_TEXT.rails.iterations}
          hint={drift ? GOAL_TEXT.rails.drift : undefined}
        >
          <Num value={iterations} tone={drift ? "wait" : "default"} />
          {drift && (
            <Text size="xs" tone="wait" className="dm-rails-drift">
              {GOAL_TEXT.rails.plannedSteps(plannedSteps)}
            </Text>
          )}
        </KeyValue>
      </KeyValueList>
    </div>
  );
}
