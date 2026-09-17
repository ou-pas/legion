// Runner port wiring for tests, the only place in the repository that does it.
//
// `index.ts` wires production; a test does not run `index.ts`, so any test file going through
// `runTask`, `resumeSession`, `pumpQueue` or `stopSession` must wire itself, otherwise the
// accessor throws saying so. `wireRealRunner()` is enough when nothing is spawned (the path refuses
// before), `wireFakeRunner(...)` swaps the runtime for a double.
//
// One file, not a copy per test: this is where the probe threshold is reproduced. An injected
// factory turns the real probe OFF, otherwise tests that never touch Docker would start probing it.
import { RUNNER_KIND, type RunnerKind } from "../../shared/enums.js";
import { registerRunnerProvider, type DaemonProbe, type ImageProbe } from "./ports.js";
import { dockerRunnerProvider } from "./provider.js";
import type { Runner } from "./types.js";

export type FakeRunnerFactory = (kind: RunnerKind, dockerHost: string | null) => Runner;

let factory: FakeRunnerFactory | null = null;
let probe: DaemonProbe | null = null;
let imageProbe: ImageProbe | null = null;

function wire(): void {
  registerRunnerProvider({
    make: (kind, dockerHost, resources) =>
      factory ? factory(kind, dockerHost) : dockerRunnerProvider.make(kind, dockerHost, resources),
    daemonProbe: (kind) => {
      if (kind !== RUNNER_KIND.docker) return null;
      // An injected probe wins: that is precisely the path it is there to test.
      if (probe) return probe;
      if (factory) return null;
      return dockerRunnerProvider.daemonProbe(kind);
    },
    imageProbe: (kind) => {
      if (kind !== RUNNER_KIND.docker) return null;
      if (imageProbe) return imageProbe;
      if (factory) return null;
      return dockerRunnerProvider.imageProbe(kind);
    },
  });
}

/** Production provider, no double: for tests that touch the manager without reaching a spawn. */
export function wireRealRunner(): void {
  factory = null;
  probe = null;
  imageProbe = null;
  wire();
}

/** `null` hands back to the production provider. */
export function wireFakeRunner(fake: FakeRunnerFactory | null): void {
  factory = fake;
  wire();
}

/** `null` hands back to the normal threshold. */
export function wireFakeDaemonProbe(fake: DaemonProbe | null): void {
  probe = fake;
  wire();
}

/** `null` hands back to the normal threshold. */
export function wireFakeImageProbe(fake: ImageProbe | null): void {
  imageProbe = fake;
  wire();
}
