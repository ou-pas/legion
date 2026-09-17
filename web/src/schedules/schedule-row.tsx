import type { Schedule } from "../api/schedules.js";
import { Chip } from "../ui/chip.js";
import { ListItem } from "../ui/list.js";
import { Caption } from "../ui/text.js";
import { formatScheduleTime, formatRelativeTime } from "./schedule-format.js";
import { SCHEDULES_TEXT } from "./text.js";
import { Clock } from "lucide-react";

type Props = {
  schedule: Schedule;
  onSelect?: (id: string) => void;
};

export function ScheduleRow({ schedule, onSelect }: Props) {
  const t = SCHEDULES_TEXT.row;
  const enabled = schedule.enabled ? t.enabled : t.disabled;
  const enabledKind = schedule.enabled ? "st-ok" : "st-neutral";

  const nextRun = schedule.nextRunAt ? t.next(formatScheduleTime(schedule.nextRunAt)) : t.noNext;
  const lastRun = schedule.lastRunAt ? t.last(formatRelativeTime(schedule.lastRunAt)) : t.neverRun;

  return (
    <button
      onClick={() => onSelect?.(schedule.id)}
      className="schedule-row"
      type="button"
      aria-label={t.detailsFor(schedule.name)}
    >
      <ListItem
        interactive
        leading={<Clock size={15} />}
        title={schedule.name}
        sub={`${schedule.cron} UTC`}
        meta={
          <div className="schedule-row-meta">
            <Chip kind={enabledKind}>{enabled}</Chip>
            <Caption tone="muted">{nextRun}</Caption>
            <Caption tone="muted">{lastRun}</Caption>
          </div>
        }
      />
    </button>
  );
}
