// How a session's files reach the daemon (05/09).
//
// `docker.ts` used to ask "is the daemon remote?" (`dockerHost !== null`), which was the wrong
// question, just close enough to the right one to hold for a year. The right one is: does the
// control plane share its filesystem with the daemon? A bind mount is resolved by the daemon, in
// the host's filesystem. When the control plane runs inside a container (the `docker` install),
// its paths (`/app/data/sessions/…`) do not exist on the host even though the daemon is the local
// one. Docker then creates the missing folder instead of failing: the session starts on an empty
// workspace, without Claude state or key, and nothing says why. Slice 02 of the multi-machine work
// had fixed that same silent failure for `ssh://`.
//
// The two questions agree on a developer machine and diverge on the container install, which is
// what unblocks the local-daemon runner in container mode.
import { runtimeMode, type RuntimeMode } from "../../updates/stamp.js";

/**
 * `true` when the session's files must be named `legion-*` volumes rather than paths on this
 * machine.
 *
 * The install mode comes from `runtimeMode()`, which reads it from a fact (`.git` at the repo
 * root) and already serves the Version card. A second way to answer the same question would end
 * up contradicting the first.
 *
 * `mode` is a parameter so both installs can be tested without building two.
 */
export function sessionFilesAreVolumes(
  dockerHost: string | null,
  mode: RuntimeMode = runtimeMode(),
): boolean {
  return dockerHost !== null || mode === "docker";
}
