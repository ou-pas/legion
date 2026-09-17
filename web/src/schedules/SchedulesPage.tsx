// The scheduled tasks screen (PR #50, mounted on 26/08).
//
// `useQuery`, not `useSuspenseQuery`: it suspends, and this application has no `<Suspense>`
// boundary. The page would have broken the tree on first load, which nobody saw because no route
// led to it. The three states are rendered by hand, as everywhere else in the app.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useProject } from "../projects/project.js";
import { schedulesApi } from "../api/schedules.js";
import { ScheduleRow } from "./schedule-row.js";
import { ScheduleDetailCard } from "./schedule-detail-card.js";
import { SCHEDULES_TEXT } from "./text.js";
import { Page } from "../ui/page.js";
import { List } from "../ui/list.js";
import { Empty } from "../ui/empty.js";
import { ErrorState } from "../ui/error-state.js";
import { Caption } from "../ui/text.js";
import "./schedules.css";

export function SchedulesPage() {
  const { projectId } = useProject();
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const t = SCHEDULES_TEXT;

  const {
    data: schedules,
    isPending,
    error,
  } = useQuery({
    queryKey: ["schedules", projectId],
    queryFn: () => schedulesApi.schedules(projectId!),
    enabled: !!projectId,
  });

  // The detail embeds its last ten runs: an opening card shows at once whether the rule ran,
  // without a second round trip that would make it flicker.
  const {
    data: selected,
    isPending: selectedLoading,
    error: selectedError,
  } = useQuery({
    queryKey: ["schedule", selectedScheduleId],
    queryFn: () => schedulesApi.schedule(selectedScheduleId!),
    enabled: !!selectedScheduleId,
  });

  return (
    <Page title={t.title} sub={t.sub}>
      {/* The empty state fills the whole page, centred (operator feedback, 04/09): in the list
          column it centred itself in 400 px, left of a big nothing. */}
      {!error && !isPending && schedules.length === 0 ? (
        <Empty variant="page" title={t.emptyTitle}>
          {t.emptyBody}
        </Empty>
      ) : (
        <div className="schedules-page">
          <div className="schedules-list-section">
            {error ? (
              <ErrorState
                title={t.failedTitle}
                detail={error instanceof Error ? error.message : String(error)}
              />
            ) : isPending ? (
              <Caption tone="muted">{t.loading}</Caption>
            ) : (
              <List label={t.listLabel}>
                {schedules.map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    onSelect={setSelectedScheduleId}
                  />
                ))}
              </List>
            )}
          </div>

          {selectedScheduleId && selected && (
            <div className="schedules-detail-section">
              <ScheduleDetailCard
                schedule={selected}
                runs={selected.runs}
                projectId={projectId ?? ""}
                isLoading={selectedLoading}
                error={selectedError instanceof Error ? selectedError.message : null}
              />
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
