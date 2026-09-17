// The disk sentinel (04/09). On a runner with NO active session there was no `legion-*` container
// to `docker exec` into, so the disk measure was permanently absent, and `diskLaunchBlocker` only
// refuses what is certain: a full disk on an idle runner blocked nothing. The fleet shares its disk
// with dev databases that are not ours, so an idle runner can fill up on its own.
//
// Same pattern as the shared browser service: a long-lived container named per runner, never
// recreated to measure. It only sleeps, so `docker exec … df` always has a process to join.
//  - It reuses the SESSION image already on each runner: a sleeping process reads none of it, so
//    there is no version drift to watch.
//  - `--network none`: it only needs to exist.
import { DOCKER_QUICK_MS, DOCKER_START_MS, type DockerExec } from "../shared/docker-exec.js";

const PREFIX = "legion-disk-sentinel-";

/** Named per RUNNER (like `browserNames`): shared, it outlives sessions. */
export const diskSentinelName = (runnerId: string): string => `${PREFIX}${runnerId}`;

/** The inverse, or `null` without the prefix; like `browserContainerRunnerId`, for orphan checks. */
export function diskSentinelRunnerId(name: string): string | null {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : null;
}

/** Idempotent: creates the container only if missing or stopped (stateless, nothing lost). Called
 *  on EVERY probe (`collectDisk`, every 30 s): normally a single `inspect`. */
export async function ensureDiskSentinel(
  name: string,
  image: string,
  dockerHost: string | null,
  exec: DockerExec,
): Promise<void> {
  let r = await exec(["inspect", "-f", "{{.State.Running}}", name], dockerHost, DOCKER_QUICK_MS);
  if (r.code === 0 && r.stdout.trim() === "true") return; // already running
  if (r.code === 0) await exec(["rm", "-f", name], dockerHost, DOCKER_QUICK_MS); // stopped carcass

  // --init as for the browser; minimal memory/CPU, it computes nothing.
  r = await exec(
    [
      "run",
      "-d",
      "--name",
      name,
      "--network",
      "none",
      "--init",
      "--memory=64m",
      "--cpus=0.1",
      "--entrypoint",
      "sleep",
      image,
      "infinity",
    ],
    dockerHost,
    DOCKER_START_MS,
  );
  if (r.code !== 0)
    throw new Error(`disk sentinel run failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
}
