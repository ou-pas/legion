import { json, post } from "./client.js";

/** What prevents the update. `up-to-date` is not a refusal, it is the normal state. `unstamped` is
 *  Docker-only: the image was built without its version, so it does not know what it runs. */
export type UpdateBlocker =
  | "sessions"
  | "dirty"
  | "unstamped"
  | "detached"
  | "up-to-date"
  | "unknown"
  | null;

/** Where the control plane runs. `bare` = a git clone (development); `docker` = a server image.
 *  They do not update the same way, and the screen says so. */
export type RuntimeMode = "bare" | "docker";

export type VersionState = {
  current: string | null;
  /** The last reachable tag: the real comparison point. */
  lastTag: string | null;
  /** Commits between `lastTag` and HEAD. Positive = unreleased code is running. */
  ahead: number;
  branch: string | null;
  sha: string;
  dirty: boolean;
  target: string | null;
  commits: string[];
  reachable: boolean;
  activeSessions: number;
  blocker: UpdateBlocker;
  /** The server's sentence, shown verbatim: it knows why it refuses. */
  reason: string | null;
  /** Why the comparison could not be made. Distinct from a refusal: here we do not KNOW. */
  checkError: "unreachable" | "unauthorized" | "not-found" | "no-slug" | null;
  /** An update is running right now (02/09), read from the `legion-update` container or the
   *  detached script's log depending on the mode. A `fetch` failing DURING an update does not reset
   *  this to `false` on screen: `infra/version-query.ts` keeps the last known state on failure. */
  updating: boolean;
  mode: RuntimeMode;
};

export const versionApi = {
  version: (): Promise<VersionState> => fetch("/api/version").then(json),
  /** Returns at once (202): the detached script outlives the server, which will restart, and the
   *  log path is the only witness of what follows. `suspendSessions` (08/09) opts into the graceful
   *  update; without it the update refuses while a session runs. */
  update: (suspendSessions = false): Promise<{ logPath: string; target: string }> =>
    post("/api/version/update", { suspendSessions }),
};
