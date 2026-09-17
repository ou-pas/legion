// The SSH target of a `DOCKER_HOST`: does this URL name a machine to run a shell on, and which?
// Shared by `sessions/runner/caffeinate.ts` and the machine metrics (02/09).
//
// `ssh://` carries a host; anything else (local socket, `tcp://`, unreadable URL) has no shell.
// Callers `spawn` with an argument array, never a composed string, so the operator's user and
// host cannot escape into a command.
export interface SshTarget {
  /** `user@host`, or `host` alone when the URL has no user. */
  target: string;
  /** The URL's port, or `null` (ssh default, 22). */
  port: string | null;
}

/** `null` = no remote shell (local socket, `tcp://`, unreadable URL). Not a failure; callers
 *  never surface it as an error. */
export function sshTargetOf(dockerHost: string): SshTarget | null {
  let url: URL;
  try {
    url = new URL(dockerHost);
  } catch {
    return null;
  }
  if (url.protocol !== "ssh:" || !url.hostname) return null;
  return {
    target: url.username ? `${url.username}@${url.hostname}` : url.hostname,
    port: url.port || null,
  };
}
