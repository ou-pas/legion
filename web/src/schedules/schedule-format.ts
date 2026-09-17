import { LOCALE } from "../ui/locale.js";
import { SCHEDULES_TEXT } from "./text.js";

export const CRON_FIELDS = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"] as const;

export function parseCron(cron: string): string[] {
  return cron.split(/\s+/).slice(0, 5);
}

export function formatScheduleTime(epochMs: number | null): string {
  if (!epochMs) return "—";
  const date = new Date(epochMs);
  return date.toLocaleDateString(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(epochMs: number | null, now = Date.now()): string {
  const t = SCHEDULES_TEXT.relativeTime;
  if (!epochMs) return t.never;
  const ms = now - epochMs;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return t.justNow;
  if (minutes < 60) return t.minutes(minutes);
  if (hours < 24) return t.hours(hours);
  if (days < 7) return t.days(days);
  if (days < 30) return t.weeks(Math.floor(days / 7));
  return t.months(Math.floor(days / 30));
}

export const OUTCOME_LABEL: Record<string, string> = SCHEDULES_TEXT.outcomeLabel;

export const OUTCOME_KIND: Record<string, string> = {
  "task-created": "st-ok",
  "skipped-disabled": "st-neutral",
  "skipped-missed": "st-wait",
  error: "st-bad",
};

export const OUTCOME_DESCRIPTION: Record<string, string> = SCHEDULES_TEXT.outcomeDescription;
