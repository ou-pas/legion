// A task's notes: what the agent meant to SAY, as opposed to what happened.
//
// The goals orchestrator already reads them to decide what comes next, and `wait_for_task` rereads
// them when a dependency wakes up, but no screen showed them although `GET /api/tasks/:id/activity`
// was shipped: a server half without its gesture, caught by `make contract` on 26/08.
//
// Not in the trace: the trace is a log of EVENTS, a note is a SENTENCE the agent wrote when it
// changed the task status. Mixed in, five sentences would drown in three hundred lines of mechanics.
//
// Across ALL sessions, and that is the point: a task rerun after a failure has several, and the note
// explaining the failure belongs to the previous one.
import { useState } from "react";
import type { TaskNote } from "../api/tasks.js";
import { Empty } from "../ui/empty.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Markdownish } from "../ui/markdownish.js";
import { LOCALE } from "../ui/locale.js";
import { Caption } from "../ui/text.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";

export function TaskNotes({ notes, at }: { notes: TaskNote[]; at?: number }) {
  const t = TASK_PAGE_TEXT.notes;
  // `Date.now()` during render is impure (`react/purity`): frozen at mount, as the dashboard does.
  const [mounted] = useState(() => Date.now());
  const now = at ?? mounted;
  if (notes.length === 0) return <Empty variant="panel" title={t.emptyTitle} />;
  return (
    <Stack gap={14}>
      {notes.map((n) => (
        <Stack key={n.id} gap={3}>
          <Row gap={8} align="center">
            <Caption weight="semi">{t.from[n.from]}</Caption>
            <Spacer />
            <Caption tone="subtle">{when(n.createdAt, now)}</Caption>
          </Row>
          {/* The agent writes Markdown in its notes: raw, it read as asterisks. Same call as the
              report. */}
          <Markdownish text={n.body} />
        </Stack>
      ))}
    </Stack>
  );
}

/** A readable date, not a timestamp: what matters is "before or after the failure", not the
 *  millisecond. The long format kicks in past a day, where "26 h ago" no longer says anything. */
function when(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return TASK_PAGE_TEXT.notes.justNow;
  if (min < 60) return TASK_PAGE_TEXT.notes.minutesAgo(min);
  if (min < 24 * 60) return TASK_PAGE_TEXT.notes.hoursAgo(Math.floor(min / 60));
  return new Date(at).toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
