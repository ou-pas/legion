// One stream for the whole app: the screen listens instead of asking (02/09).
//
// What it replaces, measured in the network inspector on an IDLE task page: five calls every four
// seconds, 75 requests per minute per viewer, 7 MB/min for `/api/tasks` alone. The server already
// published every change on its bus; the screen asked anyway.
//
// Roles: the stream is the ENGINE (one event, one targeted invalidation); the `refetchInterval`s in
// `queries.ts`, raised from 4 s to 60 s, are the SAFETY NET. A stream dying silently (proxy cut,
// sleeping tab, restarted server) must not blind the screen.
//
//  1. ONE `EventSource`, mounted at the root. One per page would open as many connections, and the
//     translation table would get copied.
//  2. Bounded exponential backoff, written here rather than left to `EventSource`. The browser
//     reconnects every three seconds forever: on a server stopped for the night, 1,200 requests an
//     hour for nothing. We close and retry later and later, up to thirty seconds.
//  3. On reconnection, EVERYTHING is invalidated. This stream replays nothing (see
//     `server/src/events/`): any signal may have been missed during the gap. Refetching all once
//     costs less than reasoning about what was missed, and far less than a lying screen.
import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { keysFor, parseControlEvent } from "./control-events.js";

export const CONTROL_STREAM_URL = "/api/events";
/** The coalescing window. An agent writing ten files publishes ten `fs_op` in a second; without it
 *  each would refetch the artifact list, replacing regular polling with a burst. */
export const COALESCE_MS = 200;
export const RETRY_BASE_MS = 1_000;
export const RETRY_MAX_MS = 30_000;

export function useControlEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // jsdom and non-browser renders have no `EventSource`. Without this guard, a test mounting the
    // shell would hit a failure unrelated to what it checks.
    if (typeof EventSource === "undefined") return;

    let stopped = false;
    let source: EventSource | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    // Serialised key → key: two signals staling the same list refetch it once.
    const pending = new Map<string, QueryKey>();

    const flush = () => {
      flushTimer = undefined;
      const keys = [...pending.values()];
      pending.clear();
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    };

    const stale = (keys: QueryKey[]) => {
      if (keys.length === 0) return;
      for (const key of keys) pending.set(JSON.stringify(key), key);
      flushTimer ??= setTimeout(flush, COALESCE_MS);
    };

    const open = () => {
      retryTimer = undefined;
      const es = new EventSource(CONTROL_STREAM_URL);
      source = es;
      es.onopen = () => {
        // `attempt > 0` = back from a cut. On the very first mount the queries run anyway:
        // invalidating everything would only add a round.
        if (attempt > 0) void queryClient.invalidateQueries();
        attempt = 0;
      };
      es.onmessage = (e: MessageEvent<string>) => {
        const ev = parseControlEvent(e.data);
        if (ev) stale(keysFor(ev));
      };
      es.onerror = () => {
        // We CLOSE ourselves: otherwise the browser runs its own 3 s loop alongside ours, and the
        // backoff means nothing.
        es.close();
        if (stopped || retryTimer) return;
        retryTimer = setTimeout(open, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt));
        attempt += 1;
      };
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      source?.close();
    };
  }, [queryClient]);
}
