import type { Schedule, ScheduleRun } from "../api/schedules.js";
import { Chip } from "../ui/chip.js";
import { KeyValueList, KeyValue } from "../ui/key-value.js";
import { Caption } from "../ui/text.js";
import { formatScheduleTime, formatRelativeTime } from "./schedule-format.js";
import { SCHEDULES_TEXT } from "./text.js";
import { ScheduleRunItem } from "./schedule-run-item.js";
import { type ReactNode } from "react";

type Props = {
  schedule: Schedule;
  runs: ScheduleRun[];
  projectId: string;
  isLoading?: boolean;
  error?: string | null;
  actions?: ReactNode;
};

/** The run summary, one number per outcome. "Missed" counts like the others: a cron skipped while
 *  the server was off is a fact to see, not a silence. */
function OutcomeSummary({ runs }: { runs: ScheduleRun[] }) {
  const t = SCHEDULES_TEXT.outcomeSummary;
  const counts: Record<string, number> = {};
  for (const run of runs) counts[run.outcome] = (counts[run.outcome] ?? 0) + 1;
  if (Object.keys(counts).length === 0) return null;
  return (
    <div className="outcome-summary">
      {counts["task-created"] && <Chip kind="st-ok">{t.created(counts["task-created"])}</Chip>}
      {counts["skipped-disabled"] && (
        <Chip kind="st-neutral">{t.disabled(counts["skipped-disabled"])}</Chip>
      )}
      {counts["skipped-missed"] && <Chip kind="st-wait">{t.missed(counts["skipped-missed"])}</Chip>}
      {counts.error && <Chip kind="st-bad">{t.errors(counts.error)}</Chip>}
    </div>
  );
}

export function ScheduleDetailCard({
  schedule,
  runs,
  projectId,
  isLoading,
  error,
  actions,
}: Props) {
  const t = SCHEDULES_TEXT.detail;
  const enabled = schedule.enabled ? SCHEDULES_TEXT.row.enabled : SCHEDULES_TEXT.row.disabled;
  const enabledKind = schedule.enabled ? "st-ok" : "st-neutral";

  return (
    <div className="schedule-detail-card">
      <div className="schedule-detail-header">
        <div>
          <h2>{schedule.name}</h2>
          <Caption tone="muted">{t.createdOn(formatScheduleTime(schedule.createdAt))}</Caption>
        </div>
        <div className="schedule-detail-actions">{actions}</div>
      </div>

      <KeyValueList>
        <KeyValue label={t.cron}>
          <span className="cron-value">{schedule.cron}</span>
        </KeyValue>
        <KeyValue label={t.timezone}>UTC</KeyValue>
        <KeyValue label={t.status}>
          <Chip kind={enabledKind}>{enabled}</Chip>
        </KeyValue>
        {schedule.nextRunAt && (
          <KeyValue label={t.nextRun}>{formatScheduleTime(schedule.nextRunAt)}</KeyValue>
        )}
        {schedule.lastRunAt && (
          <KeyValue label={t.lastRun}>{formatRelativeTime(schedule.lastRunAt)}</KeyValue>
        )}
        <KeyValue label={t.target}>
          <span>
            {schedule.agentId && <span>{t.agent(schedule.agentId)}</span>}
            {schedule.templateId && <span>{t.chain(schedule.templateId)}</span>}
            {schedule.prompt && (
              <span title={schedule.prompt} className="prompt-preview">
                {t.customPrompt}
              </span>
            )}
          </span>
        </KeyValue>
      </KeyValueList>

      <div className="schedule-history">
        <h3>{t.historyTitle(runs.length)}</h3>

        <OutcomeSummary runs={runs} />

        {isLoading && <Caption tone="muted">{t.loadingHistory}</Caption>}
        {error && <Caption tone="bad">{t.errorPrefix(error)}</Caption>}

        {!isLoading && runs.length === 0 && <Caption tone="muted">{t.noRuns}</Caption>}

        {!isLoading && runs.length > 0 && (
          <div className="runs-list">
            {runs.map((run) => (
              <ScheduleRunItem key={run.id} run={run} projectId={projectId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
