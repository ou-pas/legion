// The Version card, wired (26/08).
//
// Refresh is slow, thirty minutes: what is watched changes on a daily scale, and each round costs
// an anonymous GitHub API request (60 per hour).
//
// After the click the screen goes quiet, and that must be said. `git checkout` touches
// `server/src`, so `tsx watch` restarts the control plane: the page loses its peer mid-update. An
// interface freezing without warning reads as a failure, hence the banner naming the log, the only
// witness of what happens next.
//
// In Docker mode (01/09) it is longer still: not a restart but a rebuild, several minutes, and the
// container serving this page is destroyed and recreated. The banner also names `docker logs`,
// because a failure before the log opens can only come out there.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { versionApi } from "../api/version.js";
import { Banner } from "../ui/banner.js";
import { Card } from "../ui/card.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Stack } from "../ui/flex.js";
import { Button } from "../ui/button.js";
import { Spinner } from "../ui/spinner.js";
import { VersionCard } from "./version-card.js";
import { VERSION_TEXT } from "./text-version.js";
import { useVersionUpdate } from "./use-version-update.js";
import { versionKey, versionQueryOptions } from "./version-query.js";
import "./version-panel.css";

export function VersionPanel() {
  const qc = useQueryClient();
  const [startedLogPath, setStartedLogPath] = useState<string | null>(null);
  const { data } = useQuery(versionQueryOptions);
  const { progress, startUpdate, reset } = useVersionUpdate();
  const update = useMutation({
    mutationFn: (suspend: boolean) => versionApi.update(suspend),
    onSuccess: (r) => {
      setStartedLogPath(r.logPath);
      startUpdate(r.target, r.logPath);
    },
  });

  if (!data)
    return (
      <Card>
        <SkeletonText lines={4} label={VERSION_TEXT.loading} />
      </Card>
    );

  return (
    <Stack gap={10}>
      {startedLogPath && progress.phase === "idle" && (
        <Banner tone="wait" title={VERSION_TEXT.startedTitle}>
          {VERSION_TEXT.startedBody(startedLogPath, data.mode)}
        </Banner>
      )}

      {progress.phase === "updating" && (
        <Banner tone="wait" title={VERSION_TEXT.updateInProgress(progress.target!)}>
          <Stack gap={8}>
            <div className="version-panel-update-spinner">
              <Spinner size="sm" label={VERSION_TEXT.updateInProgress(progress.target!)} />
            </div>
          </Stack>
        </Banner>
      )}

      {progress.phase === "restarting" && (
        <Banner tone="wait" title={VERSION_TEXT.updateRestarting}>
          <Stack gap={8}>
            <div className="version-panel-update-spinner">
              <Spinner size="sm" label={VERSION_TEXT.updateRestarting} />
            </div>
          </Stack>
        </Banner>
      )}

      {progress.phase === "complete" && (
        <Banner tone="ok" title={VERSION_TEXT.updateComplete(progress.current!)}>
          <Stack gap={8}>
            <div className="version-panel-update-note">{VERSION_TEXT.updateCompleteNote}</div>
            <Button size="sm" variant="primary" onClick={() => location.reload()}>
              {VERSION_TEXT.updateReload}
            </Button>
          </Stack>
        </Banner>
      )}

      {progress.phase === "mismatch" && (
        <Banner tone="bad" title={VERSION_TEXT.updateMismatch(progress.current!, progress.target!)}>
          <Stack gap={8}>
            <div className="version-panel-update-note">
              {VERSION_TEXT.updateMismatchNote(startedLogPath!)}
            </div>
            {/* Retry, not just forget. This button only called `reset`, which clears local state:
                the banner vanished, nothing restarted, and the card button below was re-enabled by
                that same `reset`, which made the illusion perfect. Three clicks in a row left no
                server trace on 13/09 before it was measured. `update.variables` keeps the original
                gesture: an ordinary update is not replayed in place of the one suspending sessions
                first. */}
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                reset();
                update.mutate(update.variables ?? false);
              }}
            >
              {VERSION_TEXT.updateRetry}
            </Button>
          </Stack>
        </Banner>
      )}

      {progress.phase === "timeout" && (
        <Banner
          tone="bad"
          title={VERSION_TEXT.updateTimeout(Math.ceil((progress.elapsedSeconds || 0) / 60))}
        >
          <Stack gap={8}>
            <div className="version-panel-update-note">{VERSION_TEXT.updateTimeoutNote}</div>
            <Button size="sm" variant="default" onClick={reset}>
              {VERSION_TEXT.updateStartOver}
            </Button>
          </Stack>
        </Banner>
      )}

      {update.error && <Banner tone="bad" title={(update.error as Error).message} />}
      <VersionCard
        state={data}
        busy={update.isPending || progress.phase !== "idle"}
        onUpdate={(suspend) => update.mutate(suspend)}
        onRecheck={() => void qc.invalidateQueries({ queryKey: versionKey })}
      />
    </Stack>
  );
}
