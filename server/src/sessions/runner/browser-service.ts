// Shared browser service (v30, task QHHXj9Q5MI): one long-lived Playwright container per runner,
// reached over WebSocket by granted sessions (`agents.browser_access`). Shared because a Chromium
// per session costs ~500 MB and 10 s of startup for a few screenshots.
//
// Security, three walls in order of importance:
//  1. The service lives on a dedicated `--internal` docker network (`legion-browser-net-<runner>`)
//     with NO route outside. The browser only reaches what sessions ask it to load inside that
//     network. It is a UI verification tool, not a way onto the internet.
//  2. A session joins that network only if its agent has the grant; nothing by default.
//  3. The image is pinned (legion-browser:latest, built by `make image` on a tagged official
//     Playwright base), never an upstream `latest`. `playwright.connect()` requires the SAME
//     version on the client (playwright-core in session-image) and the server: both Dockerfiles
//     pin the same one.
import {
  DOCKER_QUICK_MS,
  DOCKER_START_MS,
  type DockerExec,
  docker,
} from "../../shared/docker-exec.js";
import { logControlEvent } from "../../events/control-log-store.js";

// The tag comes from the fleet image catalogue (`infra/fleet-images.ts`), which also decides what
// an update rebuilds and what the Infra screen reports as stale. Two definitions of the same tag
// would let the screen certify as current an image the runner does not start.
import { BROWSER_IMAGE, labelValue, PLAYWRIGHT_VERSION_LABEL } from "../../infra/fleet-images.js";

const BROWSER_PORT = 3000;

/** Re-exported: the type now lives in `shared/docker-exec.ts`, but this module's tests import it
 *  under this name. */
export type { DockerExec };

const dockerExec: DockerExec = docker;

/** Derived from the RUNNER, not the session: the service is shared and outlives sessions.
 *  `infra/infra.ts` recognises these prefixes and excludes them from orphan cleanup. */
export const browserNames = (runnerId: string) => ({
  container: `legion-browser-${runnerId}`,
  network: `legion-browser-net-${runnerId}`,
});

/** What sessions receive as `BROWSER_WS_ENDPOINT`, resolved by docker's internal DNS on the
 *  service network. */
export const wsEndpoint = (container: string) => `ws://${container}:${BROWSER_PORT}/`;
export const browserEndpoint = (runnerId: string) => wsEndpoint(browserNames(runnerId).container);

/** Image id then Playwright label: comparing ids says THAT there is drift, the version says WHICH
 *  (same logic as `fleet-images.ts`, which says it for the screen; here it is for session
 *  launch). */
const IMAGE_AND_VERSION_FORMAT = `{{.Image}}|{{index .Config.Labels "${PLAYWRIGHT_VERSION_LABEL}"}}`;
const TAG_IMAGE_AND_VERSION_FORMAT = `{{.Id}}|{{index .Config.Labels "${PLAYWRIGHT_VERSION_LABEL}"}}`;

/** A running container never proved it runs today's image: `docker run` pins the image at start,
 *  and a later `make image-browser` rebuilding the tag touches no running container. That was the
 *  drift of the 04/09 task (service on Playwright 1.49 while `legion-browser:latest` was already
 *  1.62.1). `null` = no proof of drift (an inspection failed, or the ids match); like `driftOf()`
 *  in `fleet-images.ts`, absence of proof accuses nothing. */
async function playwrightDrift(
  container: string,
  tag: string,
  dockerHost: string | null,
  exec: DockerExec,
): Promise<{ report: string; running: string | null; current: string | null } | null> {
  const [live, tagged] = await Promise.all([
    exec(["inspect", "-f", IMAGE_AND_VERSION_FORMAT, container], dockerHost, DOCKER_QUICK_MS),
    exec(
      ["image", "inspect", tag, "-f", TAG_IMAGE_AND_VERSION_FORMAT],
      dockerHost,
      DOCKER_QUICK_MS,
    ),
  ]);
  if (live.code !== 0 || tagged.code !== 0) return null;

  const [liveImageId, liveVersionRaw] = live.stdout.trim().split("|");
  const [taggedImageId, taggedVersionRaw] = tagged.stdout.trim().split("|");
  if (!liveImageId || !taggedImageId || liveImageId === taggedImageId) return null;

  const running = labelValue(liveVersionRaw ?? "");
  const current = labelValue(taggedVersionRaw ?? "");
  const report =
    running && current
      ? `container on Playwright ${running}, image ${tag} now carries ${current}`
      : `container on an image other than ${tag} (rebuild not propagated)`;
  return { report, running, current };
}

/** Idempotent: internal network + container, created only when missing. A stopped container
 *  (machine reboot, OOM) is replaced; the service is stateless, restarting it loses nothing.
 *  Started directly on the internal network: it has no egress at any point, not even at startup
 *  (the image ships everything, see browser-image/).
 *
 *  Same replacement when the container runs a stale image (`playwrightDrift`), which spares a
 *  session from discovering the mismatch through a `428 Precondition Required` at the end of a
 *  task (04/09). The replacement is logged in `control_events`: that was the missing part, the
 *  pinning itself already worked. */
export async function ensureBrowserService(
  n: { container: string; network: string },
  dockerHost: string | null,
  exec: DockerExec = dockerExec,
): Promise<void> {
  let r = await exec(["network", "create", "--internal", n.network], dockerHost, DOCKER_QUICK_MS);
  if (r.code !== 0 && !r.stderr.includes("already exists"))
    throw new Error(`browser network create failed: ${r.stderr.slice(0, 300)}`);

  r = await exec(["inspect", "-f", "{{.State.Running}}", n.container], dockerHost, DOCKER_QUICK_MS);
  if (r.code === 0 && r.stdout.trim() === "true") {
    const drift = await playwrightDrift(n.container, BROWSER_IMAGE, dockerHost, exec);
    if (!drift) return;
    logControlEvent(
      "warn",
      "browser",
      `browser service “${n.container}” is stale — ${drift.report} — automatic restart (stateless service)`,
      {
        container: n.container,
        tag: BROWSER_IMAGE,
        runningVersion: drift.running,
        currentVersion: drift.current,
      },
    );
    await exec(["rm", "-f", n.container], dockerHost, DOCKER_QUICK_MS);
  } else if (r.code === 0) {
    await exec(["rm", "-f", n.container], dockerHost, DOCKER_QUICK_MS); // dead container: start clean
  }

  // --init: Playwright forks browser processes; without init, zombies pile up in a long-lived
  // container. Memory/CPU limits: same as a session.
  r = await exec(
    [
      "run",
      "-d",
      "--name",
      n.container,
      "--network",
      n.network,
      "--init",
      "--memory=1g",
      "--cpus=1",
      BROWSER_IMAGE,
    ],
    dockerHost,
    DOCKER_START_MS,
  );
  if (r.code !== 0) throw new Error(`browser run failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
}

/** Never called by the session lifecycle (the service is shared). Exposed for tooling: tests, a
 *  future action on the Infra page. */
export async function stopBrowserService(
  runnerId: string,
  dockerHost: string | null,
  exec: DockerExec = dockerExec,
): Promise<void> {
  const n = browserNames(runnerId);
  await exec(["rm", "-f", n.container], dockerHost, DOCKER_QUICK_MS);
  await exec(["network", "rm", n.network], dockerHost, DOCKER_QUICK_MS);
}
