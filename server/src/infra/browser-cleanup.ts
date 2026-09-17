// The one criterion that still retires the shared browser service (v54, 03/09).
//
// `parseSessionId` (infra.ts) returns `sessionId: null` for every `legion-browser-*` on purpose:
// the service is shared, long-lived and named per runner. This module holds the other half: a
// service named for a runner that no longer exists or is disabled serves nothing (`pickRunnerRow`
// never routes there). The same code used to protect both cases, leaving
// `legion-browser-s6PeSEW3Dl` behind for the `local` runner disabled when the control plane moved.

const CONTAINER_PREFIX = "legion-browser-";
const NETWORK_PREFIX = "legion-browser-net-";

/** `null` if the name lacks the prefix. */
export function browserContainerRunnerId(name: string): string | null {
  return name.startsWith(CONTAINER_PREFIX) ? name.slice(CONTAINER_PREFIX.length) : null;
}

/** Same for networks, different prefix (`browserNames`, sessions/runner/browser-service.ts). */
export function browserNetworkRunnerId(name: string): string | null {
  return name.startsWith(NETWORK_PREFIX) ? name.slice(NETWORK_PREFIX.length) : null;
}

/** True when no session can ever reach this container: its runner is gone or disabled. An enabled
 *  runner protects its service even with no session; this must NEVER look at sessions. */
export function isOrphanBrowserContainer(
  runnerIdInName: string | null,
  runnerEnabledById: ReadonlyMap<string, boolean>,
): boolean {
  if (runnerIdInName === null) return false;
  return runnerEnabledById.get(runnerIdInName) !== true;
}

/** A network also counts as waste without ITS container, even on an enabled runner
 *  (`ensureBrowserService` would recreate one). Attached networks are protected by cleanup order
 *  (`cleanupOrphans` removes containers first), not here. */
export function isOrphanBrowserNetwork(
  runnerIdInName: string | null,
  hasContainer: boolean,
  runnerEnabledById: ReadonlyMap<string, boolean>,
): boolean {
  if (runnerIdInName === null) return false;
  return !hasContainer || runnerEnabledById.get(runnerIdInName) !== true;
}
