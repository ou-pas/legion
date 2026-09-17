// The session image state on a runner: present, stamped hash, stale, rebuilding.
import { DOCKER_PROBE_MS, docker } from "../../shared/docker-exec.js";
import { SESSION_IMAGE } from "../fleet-images.js";
import { imageRebuildRunning } from "./rebuild.js";
import { recordImageVerdict } from "./verdict-store.js";

export const PAYLOAD_HASH_LABEL = "legion.payload-hash";

export interface SessionImageState {
  present: boolean;
  builtHash: string | null;
  currentHash: string | null;
  stale: boolean;
  rebuilding: boolean;
}

/** Build-stamped label against the current payload hash. A failed `inspect` means the image is
 *  MISSING on this runner, to be shown (review 5a #3). `rebuilding` is read on the HOST daemon,
 *  where the ephemeral container runs, never on the runner. */
export async function sessionImageState(
  runner: { id: string; dockerHost: string | null },
  currentHash: string | null,
): Promise<SessionImageState> {
  const img = await docker(
    [
      "image",
      "inspect",
      SESSION_IMAGE,
      "--format",
      `{{index .Config.Labels "${PAYLOAD_HASH_LABEL}"}}`,
    ],
    runner.dockerHost,
    DOCKER_PROBE_MS,
  );
  const rebuilding = await imageRebuildRunning(runner.id);
  // Remembered for `pickRunnerRow` (verdict-store.ts): the Infra screen already probes this tag
  // every ten seconds while open. Only the default tag, not a project's image (`sessionImageFor`,
  // known debt).
  if (img.code !== 0) {
    recordImageVerdict(runner.id, SESSION_IMAGE, { ok: false, why: img.stderr.trim() || null });
    return { present: false, builtHash: null, currentHash, stale: false, rebuilding };
  }
  recordImageVerdict(runner.id, SESSION_IMAGE, { ok: true });
  const builtHash = img.stdout.trim() || null;
  const stale = currentHash !== null && (builtHash === null || builtHash !== currentHash);
  return { present: true, builtHash, currentHash, stale, rebuilding };
}
