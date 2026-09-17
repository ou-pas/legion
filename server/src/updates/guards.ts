// What prevents an update (26/08). Pure on purpose: it is this feature's safety boundary, tested
// without git, Docker or a database. Same shape as `steerRefusal` and `pauseRefusal`.
//
//  `sessions` protects work in progress: an update restarts the control plane.
//  `dirty` protects uncommitted work: a `git checkout` over changes is a silent loss.
//  `detached` protects the way back: leaving a working branch for a tag loses the context.
//  `unstamped` (01/09) protects against ignorance: an image built without the version ARGs knows
//  neither sha, tag nor origin. It used to fall into `detached`, whose message sent the operator
//  looking for a repository that does not exist.

export type UpdateBlocker =
  | "sessions"
  | "dirty"
  | "unstamped"
  | "detached"
  | "up-to-date"
  | "unknown"
  | null;

export interface UpdateState {
  /** Sessions holding a container, on all runners. */
  activeSessions: number;
  /** Uncommitted changes in the working tree (excluding `docs/STATE.md`). */
  dirty: boolean;
  /** `null` when HEAD is detached. */
  branch: string | null;
  /** The tag we would move to, or `null` if nothing is newer. */
  target: string | null;
  /** False when the forge could not be queried: we do not know whether something is newer. */
  reachable: boolean;
  /** Does the image carry its version? Optional, default yes, so bare mode (where git answers
   *  directly) has nothing to declare. */
  stamped?: boolean;
}

/** A working branch is a context nobody wants to leave with a click. */
const UPDATABLE_BRANCHES = new Set(["main", "master"]);

/**
 * `null` when allowed. The order is the message: first what would cost work, then what has nothing
 * to do.
 */
export function updateBlocker(state: UpdateState): UpdateBlocker {
  if (state.activeSessions > 0) return "sessions";
  if (state.dirty) return "dirty";
  // Before `detached`, because it is its cause: an unstamped image has no branch to show.
  if (state.stamped === false) return "unstamped";
  if (!state.branch || !UPDATABLE_BRANCHES.has(state.branch)) return "detached";
  if (!state.reachable) return "unknown";
  if (!state.target) return "up-to-date";
  return null;
}

/** Lives here, not in the screen: the server knows why it refuses. */
export function blockerReason(blocker: UpdateBlocker, state: UpdateState): string | null {
  switch (blocker) {
    // Corrected 08/09 (measured): containers are NOT taken down, `deploy/compose.yaml` only
    // declares `control-plane`. What a session really loses during `up.sh --build` is its control
    // plane: `callInternal` and `updateTask` have no replay, so an `fs_write`, `update_task` or
    // `inbox_ask` in that window returns a tool error. The turn in flight is what is protected.
    case "sessions":
      return `${state.activeSessions} session(s) are running. The update restarts the control plane for one to three minutes: their containers survive, but during that time they lose access to the file, task and inbox tools, and a turn in flight can break there.`;
    case "dirty":
      return "The working tree has uncommitted changes. Moving to a tag over them would overwrite them without saying so.";
    case "unstamped":
      return "This image was built without its version: it knows neither which commit it runs nor from which repository. Rebuild it with “./deploy/up.sh”, which stamps the sha, the tag, the branch and the origin into the image.";
    case "detached":
      return state.branch
        ? `You are on “${state.branch}”. The update only starts from main, so that a click never leaves a working branch.`
        : "HEAD is detached: nothing would say how to come back here.";
    case "unknown":
      return "GitHub cannot be reached: there is no way to know whether something newer exists.";
    case "up-to-date":
      return null; // not a refusal, the normal state
    default:
      return null;
  }
}
