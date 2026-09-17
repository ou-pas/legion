// Production implementation of the `RunnerProvider` port, wired by `index.ts` at boot.
import { DockerRunner } from "./docker.js";
import { ProcessRunner } from "./process.js";
import { dockerDaemonReachable, dockerImagePresent } from "../../shared/docker-exec.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import type { RunnerProvider } from "./ports.js";

/** Docker, except `LEGION_RUNNER=process`: the dev mode, with no daemon and no network wall. */
export const dockerRunnerProvider: RunnerProvider = {
  make(kind, dockerHost, resources) {
    return kind === RUNNER_KIND.process || process.env.LEGION_RUNNER === "process"
      ? new ProcessRunner()
      : new DockerRunner(dockerHost, resources);
  },
  daemonProbe(kind) {
    if (kind !== RUNNER_KIND.docker) return null;
    if (process.env.LEGION_RUNNER === "process") return null;
    return dockerDaemonReachable;
  },
  imageProbe(kind) {
    if (kind !== RUNNER_KIND.docker) return null;
    if (process.env.LEGION_RUNNER === "process") return null;
    return dockerImagePresent;
  },
};
