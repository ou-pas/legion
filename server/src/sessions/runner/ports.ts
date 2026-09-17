// The port through which a session gets its runtime (06/09).
//
// `manager.ts` used to build its runner (`new DockerRunner`) and daemon probe itself. Since no
// test can spawn a real container, two `set*ForTests` hooks were exported from the production
// module to swap the factory at runtime: a global injection point anyone could change, invisible
// to whoever reads `runTask`. Same direction as `inbox/ports.ts` now: `index.ts` wires the real
// implementation at boot, tests wire theirs through `test-wiring.ts`.
import type { RunnerKind } from "../../shared/enums.js";
import type { SessionResources } from "../../infra/runner/limits.js";
import type { Runner } from "./types.js";

/** Asked by `runTask` before reserving a container. Local question, answer in milliseconds. */
export type DaemonProbe = (
  dockerHost: string | null,
) => Promise<{ ok: true } | { ok: false; why: string }>;

/** Same question for an image (08/09): is it present on the daemon that will run `docker run`,
 *  not merely somewhere. */
export type ImageProbe = (
  dockerHost: string | null,
  image: string,
) => Promise<{ ok: true } | { ok: false; why: string }>;

export interface RunnerProvider {
  /** Without `resources` (tests, paths that provision nothing), `DockerRunner` falls back to its
   *  historical default. */
  make(kind: RunnerKind, dockerHost: string | null, resources?: SessionResources): Runner;
  /** `null` when no daemon is involved: probing then would make the launch depend on an
   *  environment detail rather than on the runtime actually used. */
  daemonProbe(kind: RunnerKind): DaemonProbe | null;
  /** Same guard for the image: `null` when no daemon is involved (`process` runner). */
  imageProbe(kind: RunnerKind): ImageProbe | null;
}

let impl: RunnerProvider | null = null;

export function registerRunnerProvider(provider: RunnerProvider): void {
  impl = provider;
}

/** An unwired port is an assembly fault, not a business case: silently falling back to Docker
 *  would spawn a container where nobody asked for one. */
export function runnerProvider(): RunnerProvider {
  if (!impl) throw new Error("RunnerProvider not wired: index.ts must call registerRunnerProvider");
  return impl;
}
