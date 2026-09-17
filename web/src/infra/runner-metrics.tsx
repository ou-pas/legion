// A runner's consumption (v52, 02/09): three measures, never merged; confusing them would produce
// wrong numbers with confidence. Each carries its own reason for absence (tolerated: non-mac host,
// ssh refused, budget exceeded, measuring image missing…) and its age, never a bare dash.
//
// Mock-up shape (variant A, 02/09): a mono number with its axis in small, no gauge. A vitals cell is
// ~110 px, a "CPU + gauge + %" row needed 140 and got clipped. The number's tone replaces the gauge:
// orange when it heats up, red when it overflows.
import { Caption } from "../ui/text.js";
import { Num, type NumTone } from "../ui/num.js";
import { Sparkline, type SparklinePoint } from "../ui/sparkline.js";
import { shortDuration } from "../ui/duration.js";
import { Vital } from "./runner-vitals.js";
import type { DiskInfo, HistoryPoint, RunnerMetrics, UsageSample } from "../api/infra.js";
import { INFRA_TEXT, fmtGb } from "./text.js";
import "./runner-metrics.css";

const round = (n: number): number => Math.round(n);

/** Orange when it heats up, red when it overflows; the low threshold comes from the mock-up (70%). */
const usageTone = (pct: number): NumTone | undefined =>
  pct >= 90 ? "bad" : pct >= 70 ? "wait" : undefined;

/** A free-space threshold, not an occupancy one: `--wait` under 15% free (85% used), `--bad` under
 *  5% free (95% used), as the operator asked, phrased as space left. */
const diskTone = (pct: number): NumTone | undefined =>
  pct >= 95 ? "bad" : pct >= 85 ? "wait" : undefined;

function AgeCaption({ at, now }: { at: number; now: number }) {
  return <Caption>{INFRA_TEXT.metrics.age(shortDuration(Math.max(0, now - at)))}</Caption>;
}

/** Sessions VM / the machine: same shape for both, only label, lead axis and absence tolerance
 *  change. The lead axis says what matters for that source: memory for the VM (RAM bounds one more
 *  session), CPU for the machine. The other axis goes small next to it; an unmeasurable axis
 *  disappears instead of showing `—`. */
function UsageSource({
  name,
  hint,
  lead,
  sample,
  reason,
  history,
  now,
}: {
  name: string;
  hint: string;
  lead: "mem" | "cpu";
  sample: UsageSample | null;
  reason: string | null;
  history: HistoryPoint[];
  now: number;
}) {
  const m = INFRA_TEXT.metrics;
  const axes: { unit: string; pct: number | null }[] =
    sample === null
      ? []
      : lead === "mem"
        ? [
            { unit: m.memShort, pct: sample.memPct },
            { unit: m.cpuShort, pct: sample.cpuPct },
          ]
        : [
            { unit: m.cpuShort, pct: sample.cpuPct },
            { unit: m.memShort, pct: sample.memPct },
          ];
  const ordered = axes.filter((a): a is { unit: string; pct: number } => a.pct !== null);
  const [figure, other] = ordered;
  return (
    <Vital label={name} hint={hint}>
      {sample && figure ? (
        <>
          <span className="ir-vital-figure">
            <Num value={round(figure.pct)} suffix="%" tone={usageTone(figure.pct)} />
            <span className="ir-vital-of">
              {other ? `${figure.unit} · ${round(other.pct)} % ${other.unit}` : figure.unit}
            </span>
          </span>
          <Sparkline
            name={`${m.cpu} — ${name}`}
            tone="accent"
            points={history.map((h): SparklinePoint => ({ at: h.at, value: h.cpu }))}
          />
          <AgeCaption at={sample.at} now={now} />
        </>
      ) : (
        <Caption tone="subtle">{reason}</Caption>
      )}
    </Vital>
  );
}

function DiskGauge({
  disk,
  reason,
  now,
}: {
  disk: DiskInfo | null;
  reason: string | null;
  now: number;
}) {
  return (
    <Vital label={INFRA_TEXT.metrics.disk} hint={INFRA_TEXT.metrics.diskHint}>
      {disk ? (
        <>
          <span className="ir-vital-figure">
            <Num value={round(disk.usedPct)} suffix="%" tone={diskTone(disk.usedPct)} />
            <span className="ir-vital-of">{INFRA_TEXT.metrics.diskOf(fmtGb(disk.totalMb))}</span>
          </span>
          <AgeCaption at={disk.at} now={now} />
        </>
      ) : (
        <Caption tone="subtle">{reason}</Caption>
      )}
    </Vital>
  );
}

/** A runner's three measures as vitals grid cells, in the task's order: the VM (what matters to
 *  start one more session), the machine, then the disk (the 02/09 emergency). A fragment, not a
 *  grid: the card owns the grid and also puts the places cell in it, so four sibling cells align. */
export function RunnerMetricsCells({ metrics, now }: { metrics: RunnerMetrics; now: number }) {
  return (
    <>
      <UsageSource
        name={INFRA_TEXT.metrics.vm}
        hint={INFRA_TEXT.metrics.vmHint}
        lead="mem"
        sample={metrics.vm}
        reason={metrics.vmReason}
        history={metrics.vmHistory}
        now={now}
      />
      <UsageSource
        name={INFRA_TEXT.metrics.host}
        hint={INFRA_TEXT.metrics.hostHint}
        lead="cpu"
        sample={metrics.host}
        reason={metrics.hostReason}
        history={metrics.hostHistory}
        now={now}
      />
      <DiskGauge disk={metrics.disk} reason={metrics.diskReason} now={now} />
    </>
  );
}
