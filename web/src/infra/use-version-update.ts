// Follows an update in progress. After POST /api/version/update, polls GET /api/version through
// three phases: the server still answers; it restarts (fetches fail, expected); it comes back
// (success or missed target). Not the TanStack cache: this loop must tolerate failure without
// alarming the whole screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { versionApi } from "../api/version.js";

export type UpdatePhase =
  | "idle"
  | "updating" // the server answers, update under way
  | "restarting" // the server restarts, fetches fail (expected)
  | "complete"
  | "timeout" // more than 10 min without an answer
  | "mismatch"; // the server came back with current ≠ target

export interface UpdateProgress {
  phase: UpdatePhase;
  target?: string;
  current?: string;
  elapsedSeconds?: number;
  logPath?: string;
}

const POLL_INTERVAL = 2000;
const TIMEOUT_SECONDS = 10 * 60; // 10 minutes

export function useVersionUpdate() {
  const [progress, setProgress] = useState<UpdateProgress>({ phase: "idle" });
  const targetRef = useRef<string | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Did we see the server leave? Before that, the old server answers with the old version for the
  // whole build (Docker mode: several minutes), which is not a failure.
  const sawRestartRef = useRef(false);

  const pollOnce = useCallback(async () => {
    if (!targetRef.current || !startTimeRef.current) return;

    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000;

    if (elapsed > TIMEOUT_SECONDS) {
      setProgress({
        phase: "timeout",
        target: targetRef.current,
        elapsedSeconds: Math.floor(elapsed),
      });
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    try {
      const state = await versionApi.version();
      const elapsedNow = Math.floor((Date.now() - startTimeRef.current) / 1000);

      if (state.current === targetRef.current) {
        setProgress({
          phase: "complete",
          target: targetRef.current,
          current: state.current,
          elapsedSeconds: elapsedNow,
        });
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else if (
        state.current !== null &&
        (state.mode === "docker" ? !state.updating : sawRestartRef.current)
      ) {
        // A failure verdict is not given on the first poll: during the whole build (Docker mode,
        // several minutes) the old server answers with the old version, and the first poll wrongly
        // concluded "stopped" (seen on v0.5.0 → v0.6.0, 02/09). In Docker, failure is
        // `updating: false` with the wrong version (build failed, or server back beside the target),
        // and a network blip mid-build does not fool it. In bare mode there is no lock to read: we
        // require having seen the restart; a script dying before restarting ends in the timeout.
        setProgress({
          phase: "mismatch",
          target: targetRef.current,
          current: state.current,
          elapsedSeconds: elapsedNow,
        });
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else {
        // The updater still runs (or `current` is null): the update is in progress.
        setProgress((prev) =>
          prev.phase === "restarting"
            ? { ...prev, elapsedSeconds: elapsedNow }
            : { phase: "updating", target: targetRef.current!, elapsedSeconds: elapsedNow },
        );
      }
    } catch {
      // The fetch failed: the signal that the server restarts. Expected.
      sawRestartRef.current = true;
      const elapsedNow = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setProgress((prev) => {
        if (prev.phase !== "restarting") {
          return { phase: "restarting", target: targetRef.current!, elapsedSeconds: elapsedNow };
        }
        return { ...prev, elapsedSeconds: elapsedNow };
      });
    }
  }, []);

  const startUpdate = useCallback(
    (target: string, logPath: string) => {
      targetRef.current = target;
      startTimeRef.current = Date.now();
      sawRestartRef.current = false;
      setProgress({ phase: "updating", target, logPath });

      void pollOnce();
    },
    [pollOnce],
  );

  const reset = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    targetRef.current = null;
    startTimeRef.current = null;
    sawRestartRef.current = false;
    setProgress({ phase: "idle" });
  }, []);

  useEffect(() => {
    if (
      progress.phase === "idle" ||
      progress.phase === "complete" ||
      progress.phase === "timeout" ||
      progress.phase === "mismatch"
    ) {
      return;
    }

    if (!pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(() => {
        void pollOnce();
      }, POLL_INTERVAL);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [progress.phase, pollOnce]);

  return { progress, startUpdate, reset };
}
