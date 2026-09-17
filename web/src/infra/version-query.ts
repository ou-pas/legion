// `/api/version` options, shared (02/09) by the bar (root, `router.tsx`), the Version panel
// (`VersionPanel.tsx`) and the return banner (`update-return-banner.tsx`). All three read the same
// TanStack cache key; if each filled it with its own settings, the last mounted would silently
// impose its pace on the others.
//
// The pace speeds up during an update. Otherwise what is watched changes daily: thirty minutes, and
// each round costs a GitHub API request. But an update lasts minutes, precisely when someone may
// leave the Version panel: without a short pace here at the root, nothing would notice before the
// next thirty-minute round (operator's finding, 02/09).
//
// `retry: false`: a fetch failing during an update is the expected signal of the restart (bare mode)
// or the container switch (Docker mode), not a failure to retry in bursts. The next tick, three
// seconds later, is the retry. And TanStack never clears `data` on failure: the last response stays
// shown until the next fetch succeeds, which freezes the bar and panel instead of flickering.
import type { UseQueryOptions } from "@tanstack/react-query";
import { versionApi, type VersionState } from "../api/version.js";

export const versionKey = ["version"] as const;

const IDLE_POLL_MS = 30 * 60_000;
const UPDATING_POLL_MS = 3_000;

export const versionQueryOptions = {
  queryKey: versionKey,
  queryFn: () => versionApi.version(),
  staleTime: 5 * 60_000,
  retry: false,
  refetchInterval: (query: { state: { data?: VersionState } }) =>
    query.state.data?.updating ? UPDATING_POLL_MS : IDLE_POLL_MS,
} satisfies UseQueryOptions<VersionState>;
