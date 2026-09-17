import { Link as RouterLink } from "@tanstack/react-router";
import type { ScheduleRun } from "../api/schedules.js";
import {
  formatScheduleTime,
  OUTCOME_DESCRIPTION,
  OUTCOME_LABEL,
  OUTCOME_KIND,
} from "./schedule-format.js";
import { Chip } from "../ui/chip.js";
import { KeyValueList, KeyValue } from "../ui/key-value.js";
import { Caption } from "../ui/text.js";
import { Link } from "../ui/link.js";
import { SCHEDULES_TEXT } from "./text.js";

type Props = {
  run: ScheduleRun;
  projectId: string;
};

export function ScheduleRunItem({ run, projectId }: Props) {
  const outcomeLabel = OUTCOME_LABEL[run.outcome] || run.outcome;
  const outcomeKind = OUTCOME_KIND[run.outcome] || "st-neutral";
  const outcomeDescription = OUTCOME_DESCRIPTION[run.outcome] || "";

  return (
    <div className="schedule-run-item">
      <div className="schedule-run-header">
        <time dateTime={new Date(run.firedAt).toISOString()}>
          {formatScheduleTime(run.firedAt)}
        </time>
        <Chip kind={outcomeKind}>{outcomeLabel}</Chip>
      </div>
      <Caption tone="muted">{outcomeDescription}</Caption>
      {run.taskId && (
        <KeyValueList>
          <KeyValue label={SCHEDULES_TEXT.runItem.task}>
            <Link
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/tasks/$taskId"
                  params={{ projectId, taskId: run.taskId! }}
                  {...p}
                />
              )}
            >
              {run.taskId}
            </Link>
          </KeyValue>
        </KeyValueList>
      )}
      {run.reason && (
        <KeyValueList>
          <KeyValue label={SCHEDULES_TEXT.runItem.error}>
            <span className="error-reason">{run.reason}</span>
          </KeyValue>
        </KeyValueList>
      )}
    </div>
  );
}
